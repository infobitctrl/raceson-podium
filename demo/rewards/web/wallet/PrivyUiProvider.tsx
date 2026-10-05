"use client";

import type { ComponentProps } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { StyleSheetManager, type ShouldForwardProp } from "styled-components";

// Privy 3.42's transaction accordion forwards this styling prop to a div.
// Keep it available to styled/custom components, but out of native HTML.
const forwardPrivyProp: ShouldForwardProp<"web"> = (prop, target) =>
  typeof target !== "string" || prop !== "isActive";

export default function PrivyUiProvider(props: ComponentProps<typeof PrivyProvider>) {
  return <StyleSheetManager shouldForwardProp={forwardPrivyProp}>
    <PrivyProvider {...props} />
  </StyleSheetManager>;
}
