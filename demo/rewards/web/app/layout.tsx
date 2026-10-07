import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { AppThemeProvider } from "@/shared/theme/AppThemeProvider";
import "../../../../apps/web/src/index.css";
import "./podium.css";
// The client-only router lazily loads reward screens. Keep their scoped CSS in
// the demo's initial stylesheet, including direct links and cold page loads.
// This imports no private screen data, wallet provider or production bootstrap.
import "../../../../apps/web/src/features/rewards/components/Podium.module.css";
import "../../../../apps/web/src/features/rewards/components/AthleteRewards.module.css";
import "../../../../apps/web/src/features/rewards/components/RewardWalletSetup.module.css";
import "../../../../apps/web/src/features/rewards/components/RewardActionProgress.module.css";
import "../../../../apps/web/src/features/rewards/components/PodiumHeader.module.css";
import "../../../../apps/web/src/features/rewards/screens/SponsorDiscovery.module.css";
import "../../../../apps/web/src/features/rewards/components/RewardEditorial.module.css";
import "../../../../apps/web/src/features/rewards/components/RewardSetup.module.css";
import "../../../../apps/web/src/features/rewards/components/RewardReviewWorkspace.module.css";
import "../../../../apps/web/src/features/rewards/components/RewardResultsTable.module.css";
import "../../../../apps/web/src/features/rewards/components/ControllerWorkflow.module.css";
import "../../../../apps/web/src/features/rewards/components/GuidedRewardSetup.module.css";
import "../../../../apps/web/src/features/rewards/components/RewardLeagueMetrics.module.css";
import "../../../../apps/web/src/features/rewards/components/RewardWorkspace.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorProgress.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorStudio.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorExact.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorFunding.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorLaunch.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorCategoryAllocation.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorBulkCategories.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorRaceScope.module.css";
import "../../../../apps/web/src/features/rewards/components/SponsorPreparedCategoryPreview.module.css";
import "../../../../apps/web/src/features/rewards/components/DistributionExplorer.module.css";
import "../../../../apps/web/src/features/rewards/screens/ProgrammeSourceMapping.module.css";
import "../../../../apps/web/src/features/rewards/screens/ContractCanary.module.css";
import "../../../../apps/web/src/features/rewards/screens/RewardProgramme.module.css";

// Retain the shared font variable names used by compatibility components.
const sans = DM_Sans({ variable: "--font-plus-jakarta", subsets: ["latin", "latin-ext"], weight: "variable", display: "swap" });
const display = Bricolage_Grotesque({ variable: "--font-outfit", subsets: ["latin", "latin-ext"], weight: "variable", display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin", "latin-ext"], weight: "variable", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "RacesOn Podium · Testnet",
  description: "Sponsor-funded sporting rewards on Monad testnet. Test MON only.",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function DemoLayout({ children }: { children: ReactNode }) {
  return <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
    <body className="podium"><AppThemeProvider>{children}</AppThemeProvider></body>
  </html>;
}
