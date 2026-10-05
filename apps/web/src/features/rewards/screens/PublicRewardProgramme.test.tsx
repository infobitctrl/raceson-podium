import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n/I18nProvider";
import PublicRewardProgramme from "./PublicRewardProgramme";
it.each(["en", "hr"] as const)("retired prospectus leaves the creation path available in %s", locale => {
 render(<I18nProvider initialLocale={locale}><MemoryRouter><PublicRewardProgramme /></MemoryRouter></I18nProvider>);
 expect(screen.getByRole("heading",{name:locale==="en"?"Programme not found":"Program nije pronađen"})).toBeVisible();
 expect(screen.getByRole("link",{name:locale==="en"?"Choose an event to support":"Odaberi događaj za podršku"})).toHaveAttribute("href","/rewards/events");
 expect(screen.getByRole("link",{name:locale==="en"?"View campaigns":"Pogledaj kampanje"})).toHaveAttribute("href","/rewards/campaigns");
 expect(screen.queryByText("Šibenik Trail League")).not.toBeInTheDocument();
});
