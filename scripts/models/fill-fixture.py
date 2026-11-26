import argparse
import json
from pathlib import Path

import coremltools as ct
from coremltools.converters.mil import Builder as mb

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
args = parser.parse_args()

side = 1024


@mb.program(
    input_specs=[mb.TensorSpec(shape=(1, 3, side, side)), mb.TensorSpec(shape=(1, 1, side, side))],
    opset_version=ct.target.macOS15,
)
def inverted_inside_hole(image, mask):
    hole = mb.cast(x=mb.greater(x=mask, y=0.5), dtype="fp32")
    kept = mb.mul(x=image, y=mb.sub(x=1.0, y=hole))
    invented = mb.mul(x=mb.sub(x=1.0, y=image), y=hole)
    return mb.mul(x=mb.add(x=kept, y=invented), y=255.0, name="output")


model = ct.convert(
    inverted_inside_hole,
    inputs=[
        ct.ImageType(name="image", shape=(1, 3, side, side), scale=1 / 255, color_layout=ct.colorlayout.RGB),
        ct.ImageType(name="mask", shape=(1, 1, side, side), scale=1 / 255, color_layout=ct.colorlayout.GRAYSCALE),
    ],
    outputs=[ct.ImageType(name="output", color_layout=ct.colorlayout.RGB)],
    convert_to="mlprogram",
    compute_precision=ct.precision.FLOAT32,
    minimum_deployment_target=ct.target.macOS15,
)
spec = model.get_spec()
output = spec.description.output[0].type
output.imageType.colorSpace = ct.proto.FeatureTypes_pb2.ImageFeatureType.RGB
output.imageType.width = side
output.imageType.height = side
ct.models.MLModel(spec, weights_dir=model.weights_dir).save(args.out)

def holds_files(item):
    path = Path(args.out) / "Data" / item["path"]
    return path.is_file() or any(child.is_file() for child in path.rglob("*"))


manifest_path = Path(args.out) / "Manifest.json"
manifest = json.loads(manifest_path.read_text())
manifest["itemInfoEntries"] = {
    key: item for key, item in manifest["itemInfoEntries"].items() if holds_files(item)
}
manifest_path.write_text(json.dumps(manifest, indent=4, sort_keys=True) + "\n")
