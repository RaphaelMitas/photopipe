import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserToolbar } from "./BrowserToolbar";

afterEach(cleanup);

function toolbar(props: Partial<Parameters<typeof BrowserToolbar>[0]> = {}) {
  const onSort = vi.fn();
  render(
    <BrowserToolbar
      purpose="Cull and rate."
      view="grid"
      onView={vi.fn()}
      sort="name"
      onSort={onSort}
      scoreReady={true}
      scoring={null}
      justRated={false}
      {...props}
    />,
  );
  return { onSort };
}

function openSortMenu() {
  fireEvent.keyDown(screen.getByTestId("sort"), { key: "Enter" });
  return screen.getByTestId("sort-score");
}

describe("BrowserToolbar", () => {
  it("sorts by Instinct once the project is rated", () => {
    const { onSort } = toolbar();
    fireEvent.click(openSortMenu());
    expect(onSort).toHaveBeenCalledWith("score");
  });

  it("names the rating pass and keeps Instinct out of reach while it runs", () => {
    const { onSort } = toolbar({
      scoreReady: false,
      scoring: { done: 620, total: 2003, running: true },
    });
    expect(screen.getByTestId("rating-now")).toHaveTextContent(
      "Instinct is rating · 620 of 2,003",
    );
    expect(screen.getByTestId("rating-progress")).toBeInTheDocument();
    expect(screen.queryByText("Cull and rate.")).not.toBeInTheDocument();

    const option = openSortMenu();
    expect(option).toHaveAttribute("data-disabled");
    fireEvent.click(option);
    expect(onSort).not.toHaveBeenCalled();
  });

  it("says nothing about rating when no pass is running", () => {
    toolbar();
    expect(screen.queryByTestId("rating-now")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rating-progress")).not.toBeInTheDocument();
    expect(screen.getByText("Cull and rate.")).toBeInTheDocument();
  });

  it("hands the new sort over when the pass has just finished", () => {
    const { onSort } = toolbar({ justRated: true });
    fireEvent.click(screen.getByTestId("rated-offer"));
    expect(onSort).toHaveBeenCalledWith("score");
  });

  it("does not offer a sort you are already using", () => {
    toolbar({ justRated: true, sort: "score" });
    expect(screen.queryByTestId("rated-offer")).not.toBeInTheDocument();
  });
});
