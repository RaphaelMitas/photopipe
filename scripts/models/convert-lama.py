import argparse
import collections
import importlib.util
import pickle
import sys
import types
from pathlib import Path

import coremltools as ct
import torch
import torch.nn as nn

parser = argparse.ArgumentParser()
parser.add_argument("--code", required=True)
parser.add_argument("--checkpoint", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()

package = Path(args.code) / "saicinpainting"


def stub(name, path=None):
    module = types.ModuleType(name)
    if path is not None:
        module.__path__ = [str(path)]
    sys.modules[name] = module
    return module


stub("saicinpainting", package)
stub("saicinpainting.training", package / "training")
stub("saicinpainting.training.modules", package / "training" / "modules")
stub("saicinpainting.utils").get_shape = lambda t: tuple(t.shape)


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


modules = package / "training" / "modules"
for name in ["depthwise_sep_conv", "multidilated_conv", "base", "squeeze_excitation", "spatial_transform", "ffc"]:
    load(f"saicinpainting.training.modules.{name}", modules / f"{name}.py")
ffc = sys.modules["saicinpainting.training.modules.ffc"]


class Ignored:
    def __init__(self, *args, **kwargs):
        pass

    def __setstate__(self, state):
        pass

    def __call__(self, *args, **kwargs):
        return self


ALLOWED = {
    ("collections", "OrderedDict"): collections.OrderedDict,
    ("collections", "defaultdict"): collections.defaultdict,
    ("builtins", "dict"): dict,
    ("builtins", "list"): list,
    ("__builtin__", "dict"): dict,
    ("__builtin__", "list"): list,
    ("__builtin__", "long"): int,
    ("torch._utils", "_rebuild_tensor_v2"): torch._utils._rebuild_tensor_v2,
    ("torch", "FloatStorage"): torch.FloatStorage,
    ("torch", "LongStorage"): torch.LongStorage,
}
IGNORED_MODULES = ("omegaconf", "pytorch_lightning", "typing")


class Restricted(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) in ALLOWED:
            return ALLOWED[(module, name)]
        if module.split(".")[0] in IGNORED_MODULES:
            return Ignored
        raise pickle.UnpicklingError(f"refusing {module}.{name}")


restricted = types.ModuleType("restricted_pickle")
restricted.Unpickler = Restricted
restricted.load = pickle.load
restricted.__name__ = "pickle"

checkpoint = torch.load(args.checkpoint, map_location="cpu", pickle_module=restricted, weights_only=False)
weights = {k[len("generator."):]: v for k, v in checkpoint["state_dict"].items() if k.startswith("generator.")}

generator = ffc.FFCResNetGenerator(
    input_nc=4, output_nc=3, ngf=64, n_downsampling=3, n_blocks=18, add_out_act="sigmoid",
    init_conv_kwargs={"ratio_gin": 0, "ratio_gout": 0, "enable_lfu": False},
    downsample_conv_kwargs={"ratio_gin": 0, "ratio_gout": 0, "enable_lfu": False},
    resnet_conv_kwargs={"ratio_gin": 0.75, "ratio_gout": 0.75, "enable_lfu": False},
)
generator.load_state_dict(weights, strict=True)
generator.eval()


class Inpaint(nn.Module):
    def __init__(self, generator):
        super().__init__()
        self.generator = generator

    def forward(self, image, mask):
        hole = (mask > 0.5).float()
        known = image * (1 - hole)
        return self.generator(torch.cat([known, hole], dim=1)) * 255


model = Inpaint(generator).eval()
size = 1024
example_image = torch.rand(1, 3, size, size)
example_mask = torch.zeros(1, 1, size, size)
example_mask[:, :, size // 3: size // 2, size // 3: size // 2] = 1

with torch.no_grad():
    traced = torch.jit.trace(model, (example_image, example_mask))
mlmodel = ct.convert(
    traced,
    inputs=[
        ct.ImageType(name="image", shape=(1, 3, size, size), scale=1 / 255, color_layout=ct.colorlayout.RGB),
        ct.ImageType(name="mask", shape=(1, 1, size, size), scale=1 / 255, color_layout=ct.colorlayout.GRAYSCALE),
    ],
    outputs=[ct.ImageType(name="output", color_layout=ct.colorlayout.RGB)],
    convert_to="mlprogram",
    compute_precision=ct.precision.FLOAT32,
    minimum_deployment_target=ct.target.macOS15,
)
mlmodel.short_description = "Big-LaMa (Suvorov et al.), weights from smartywu/big-lama, converted at full precision"
mlmodel.license = "Apache-2.0"
mlmodel.save(args.out)
print("saved", args.out)
