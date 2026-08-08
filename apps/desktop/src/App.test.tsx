import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("App", () => {
  it("shows the sidecar version after the handshake", async () => {
    invoke.mockResolvedValue({ version: "9.9.9-test", protocol: 1 });
    render(<App />);
    expect(
      await screen.findByText("photopipe-core v9.9.9-test · protocol 1"),
    ).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("core_request", { method: "version" });
  });

  it("surfaces a sidecar failure instead of hanging", async () => {
    invoke.mockRejectedValue("spawn failed");
    render(<App />);
    expect(
      await screen.findByText(/core unreachable: spawn failed/),
    ).toBeInTheDocument();
  });
});
