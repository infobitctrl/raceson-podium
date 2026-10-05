import { fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { useState, type ReactNode } from "react";
import styled from "styled-components";
import { expect, it, vi } from "vitest";
import PrivyUiProvider from "./PrivyUiProvider";

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: ReactNode }) => children,
}));

const Panel = styled.div<{ isActive: string }>`
  color: ${props => props.isActive === "true" ? "rgb(0, 128, 0)" : "rgb(255, 0, 0)"};
`;
const CustomPanel = styled(({ isActive, className }: { isActive: boolean; className?: string }) =>
  <div className={className} data-testid="custom-panel" data-active={String(isActive)} />)``;

function TransactionDetails() {
  const [open, setOpen] = useState(false);
  return createPortal(<Panel isActive={String(open)} data-testid="details" data-open={String(open)}>
    <button aria-expanded={open} onClick={() => setOpen(value => !value)}>Transaction details</button>
    <CustomPanel isActive={open} />
  </Panel>, document.body);
}

it("keeps a portalled transaction accordion interactive and styled without leaking isActive into HTML", () => {
  const error = vi.spyOn(console, "error");
  try {
    render(<PrivyUiProvider appId="synthetic-test-app"><TransactionDetails /></PrivyUiProvider>);
    const details = screen.getByTestId("details");
    expect(details).not.toHaveAttribute("isactive");
    expect(details).toHaveStyle({ color: "rgb(255, 0, 0)" });
    expect(details).toHaveAttribute("data-open", "false");
    fireEvent.click(screen.getByRole("button", { name: "Transaction details" }));
    expect(details).toHaveAttribute("data-open", "true");
    expect(details).not.toHaveAttribute("isactive");
    expect(details).toHaveStyle({ color: "rgb(0, 128, 0)" });
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("custom-panel")).toHaveAttribute("data-active", "true");
    expect(error).not.toHaveBeenCalled();
  } finally { error.mockRestore(); }
});
