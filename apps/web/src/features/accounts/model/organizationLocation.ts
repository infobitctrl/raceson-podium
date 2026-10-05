import { countryName, countryOptions } from "@/shared/domain/countries";

export const organizationCountryOptions = countryOptions;

export const croatianCountyCityOptions = [
  {
    county: "Bjelovarsko-bilogorska županija",
    cities: ["Bjelovar", "Čazma", "Daruvar", "Garešnica", "Grubišno Polje"],
  },
  {
    county: "Brodsko-posavska županija",
    cities: ["Nova Gradiška", "Slavonski Brod"],
  },
  {
    county: "Dubrovačko-neretvanska županija",
    cities: ["Dubrovnik", "Korčula", "Metković", "Opuzen", "Ploče"],
  },
  { county: "Grad Zagreb", cities: ["Zagreb"] },
  {
    county: "Istarska županija",
    cities: ["Buje", "Buzet", "Labin", "Novigrad", "Pazin", "Poreč", "Pula", "Rovinj", "Umag", "Vodnjan"],
  },
  {
    county: "Karlovačka županija",
    cities: ["Duga Resa", "Karlovac", "Ogulin", "Ozalj", "Slunj"],
  },
  {
    county: "Koprivničko-križevačka županija",
    cities: ["Đurđevac", "Koprivnica", "Križevci"],
  },
  {
    county: "Krapinsko-zagorska županija",
    cities: ["Donja Stubica", "Klanjec", "Krapina", "Oroslavje", "Pregrada", "Zabok", "Zlatar"],
  },
  {
    county: "Ličko-senjska županija",
    cities: ["Gospić", "Novalja", "Otočac", "Senj"],
  },
  {
    county: "Međimurska županija",
    cities: ["Čakovec", "Mursko Središće", "Prelog"],
  },
  {
    county: "Osječko-baranjska županija",
    cities: ["Beli Manastir", "Belišće", "Donji Miholjac", "Đakovo", "Našice", "Osijek", "Valpovo"],
  },
  {
    county: "Požeško-slavonska županija",
    cities: ["Kutjevo", "Lipik", "Pakrac", "Pleternica", "Požega"],
  },
  {
    county: "Primorsko-goranska županija",
    cities: ["Bakar", "Cres", "Crikvenica", "Čabar", "Delnice", "Kastav", "Kraljevica", "Krk", "Mali Lošinj", "Novi Vinodolski", "Opatija", "Rab", "Rijeka", "Vrbovsko"],
  },
  {
    county: "Sisačko-moslavačka županija",
    cities: ["Glina", "Hrvatska Kostajnica", "Kutina", "Novska", "Petrinja", "Popovača", "Sisak"],
  },
  {
    county: "Splitsko-dalmatinska županija",
    cities: ["Hvar", "Imotski", "Kaštela", "Komiža", "Makarska", "Omiš", "Sinj", "Solin", "Split", "Stari Grad", "Supetar", "Trilj", "Trogir", "Vis", "Vrgorac", "Vrlika"],
  },
  {
    county: "Šibensko-kninska županija",
    cities: ["Drniš", "Knin", "Skradin", "Šibenik", "Vodice"],
  },
  {
    county: "Varaždinska županija",
    cities: ["Ivanec", "Lepoglava", "Ludbreg", "Novi Marof", "Varaždin", "Varaždinske Toplice"],
  },
  {
    county: "Virovitičko-podravska županija",
    cities: ["Orahovica", "Slatina", "Virovitica"],
  },
  {
    county: "Vukovarsko-srijemska županija",
    cities: ["Ilok", "Otok", "Vinkovci", "Vukovar", "Županja"],
  },
  {
    county: "Zadarska županija",
    cities: ["Benkovac", "Biograd na Moru", "Nin", "Obrovac", "Pag", "Zadar"],
  },
  {
    county: "Zagrebačka županija",
    cities: ["Dugo Selo", "Ivanić-Grad", "Jastrebarsko", "Samobor", "Sveta Nedelja", "Sveti Ivan Zelina", "Velika Gorica", "Vrbovec", "Zaprešić"],
  },
] as const;

export const croatianCountyOptions: readonly string[] = croatianCountyCityOptions.map(({ county }) => county);

export function citiesForCroatianCounty(county: string): readonly string[] {
  return croatianCountyCityOptions.find((option) => option.county === county)?.cities ?? [];
}

export function organizationCountryLabel(countryCode: string) {
  return countryName(countryCode);
}
