import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AskPanel } from "./AskPanel";

describe("AskPanel", () => {
  it("shows the placeholder prompt initially", () => {
    render(<AskPanel ask={async () => "x"} />);
    expect(screen.getByText(/Ask a question about this change/i)).toBeInTheDocument();
  });

  it("submits a question and renders the answer", async () => {
    const ask = vi.fn().mockResolvedValue("It mints a token.");
    render(<AskPanel ask={ask} />);
    fireEvent.change(screen.getByPlaceholderText("ask about this diff…"), {
      target: { value: "why?" },
    });
    fireEvent.click(screen.getByText("Ask"));

    expect(await screen.findByText("It mints a token.")).toBeInTheDocument();
    expect(screen.getByText("why?")).toBeInTheDocument();
    expect(ask).toHaveBeenCalledWith("why?");
  });

  it("does not submit empty questions", () => {
    const ask = vi.fn().mockResolvedValue("x");
    render(<AskPanel ask={ask} />);
    fireEvent.click(screen.getByText("Ask"));
    expect(ask).not.toHaveBeenCalled();
  });
});
