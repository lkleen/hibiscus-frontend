import type { TaxSection, TaxTagCode } from '@hibiscus-frontend/shared/contracts/tax-tags';

/** The built-in "not tax-relevant" tag: stops inheritance from a tagged parent. Never served, edited or deleted as a section. */
export const TAX_NOT_RELEVANT_CODE: TaxTagCode = 'St-0';

/** The row that keeps `St-0` a valid foreign key target of `hf_category_tax_tag`. */
export const TAX_NOT_RELEVANT_SECTION: TaxSection = {
  code: TAX_NOT_RELEVANT_CODE,
  name: 'Nicht steuerrelevant',
  form: null,
  belongs: null,
  excludes: null,
  receipts: null,
  note: null,
};

/**
 * The sections seeded once when `hf_tax_section` is created (or migrated from its one-column
 * form); afterwards the user owns them and a deleted one never comes back.
 */
export const DEFAULT_TAX_SECTIONS: readonly TaxSection[] = [
  {
    code: 'St-WK',
    name: 'Werbungskosten',
    form: 'Anlage N',
    belongs:
      'Arbeitsmittel, Fachliteratur, Aus- und Fortbildung, Beiträge zu Gewerkschaften und Berufsverbänden, Bewerbungskosten, Dienstreisen, häusliches Arbeitszimmer bzw. Homeoffice.',
    excludes:
      'Fahrten zur ersten Tätigkeitsstätte: Sie werden über die Entfernungspauschale je Kilometer geltend gemacht, nicht mit Tankbelegen. Kleidung, die du auch privat tragen kannst.',
    receipts: 'Rechnungen und Quittungen, Teilnahmebestätigungen.',
    note: 'Werbungskosten lohnen sich erst oberhalb des Arbeitnehmer-Pauschbetrags; das Finanzamt setzt den höheren Wert an.',
  },
  {
    code: 'St-VA',
    name: 'Vorsorgeaufwendungen',
    form: 'Anlage Vorsorgeaufwand',
    belongs:
      'Kranken- und Pflegeversicherung, Haftpflicht-, Unfall- und Berufsunfähigkeitsversicherung, Beiträge zur Altersvorsorge einschließlich Riester und Rürup.',
    excludes: 'Sachversicherungen wie Hausrat-, Wohngebäude- oder Kfz-Kaskoversicherung.',
    receipts: 'Die jährlichen Beitragsbescheinigungen der Versicherer.',
    note: 'Viele Versicherer und Vorsorgeanbieter melden die Beiträge elektronisch an das Finanzamt; gleiche mit ihren Bescheinigungen ab.',
  },
  {
    code: 'St-SA',
    name: 'Sonderausgaben',
    form: 'Anlage Sonderausgaben',
    belongs:
      'Direkt gezahlte Kirchensteuer, Spenden und Mitgliedsbeiträge an gemeinnützige Organisationen und politische Parteien, deine eigene erste Berufsausbildung oder dein Erststudium.',
    excludes:
      'Kirchensteuer, die vom Lohn einbehalten wurde; sie kommt aus der Lohnsteuerbescheinigung.',
    receipts: 'Zuwendungsbestätigungen; bei kleinen Spenden genügt oft der Kontoauszug.',
    note: 'Spenden setzen einen als gemeinnützig anerkannten Empfänger voraus.',
  },
  {
    code: 'St-AB',
    name: 'Außergewöhnliche Belastungen',
    form: 'Anlage Außergewöhnliche Belastungen',
    belongs:
      'Selbst gezahlte Krankheitskosten (Arzt, Zahnarzt, Medikamente, Brille, Therapie), Pflegekosten, behinderungsbedingte Kosten.',
    excludes: 'Alles, was eine Versicherung erstattet, sowie Vorsorge- und Wellnessangebote.',
    receipts:
      'Rechnungen, Verordnungen und für manche Behandlungen ein vorher ausgestelltes ärztliches Attest.',
    note: 'Es zählt nur der Teil oberhalb deiner zumutbaren Belastung; das Finanzamt berechnet sie aus Einkommen und Familiensituation.',
  },
  {
    code: 'St-HH',
    name: 'Haushaltsnahe Dienstleistungen und Handwerker (§35a EStG)',
    form: 'Anlage Haushaltsnahe Aufwendungen',
    belongs:
      'Haushaltsnahe Dienstleistungen (Reinigung, Gartenpflege, Hausmeister, Schornsteinfeger, Winterdienst) und Handwerkerleistungen für Reparatur, Wartung und Modernisierung in deiner Wohnung.',
    excludes: 'Materialkosten, Neubauten, Barzahlungen.',
    receipts:
      'Rechnungen mit getrennt ausgewiesenem Arbeitslohn, Überweisungsbelege; Mieter finden begünstigte Kosten auch in der Nebenkostenabrechnung.',
    note: 'Es zählen nur Arbeits-, Fahrt- und Maschinenkosten einschließlich Umsatzsteuer und nur bei Zahlung per Überweisung; nimm sie aus der Rechnung, nicht aus dieser Summe.',
  },
  {
    code: 'St-KI',
    name: 'Kinderbetreuung und Schulgeld',
    form: 'Anlage Kind',
    belongs: 'Kinderbetreuung (Kita, Krippe, Tagesmutter, Hort), Schulgeld für Privatschulen.',
    excludes: 'Verpflegung, Nachhilfe, Sport- und Musikunterricht.',
    receipts: 'Gebührenbescheide und Rechnungen.',
    note: 'Betreuungskosten zählen nur bei Zahlung auf das Konto des Anbieters, nicht bar.',
  },
  {
    code: 'St-V',
    name: 'Vermietung und Verpachtung',
    form: 'Anlage V',
    belongs:
      'Erhaltene Mieten und Nebenkosten sowie für das vermietete Objekt Schuldzinsen, Instandhaltung, Grundsteuer, Versicherungen und Verwaltungskosten.',
    excludes: 'Tilgungen (nur die Zinsen zählen) und Kosten der eigenen Wohnung.',
    receipts: 'Mietverträge, Kreditauszüge, Rechnungen, Nebenkostenabrechnungen.',
    note: 'Der Kaufpreis wird über Jahre abgeschrieben und taucht nicht in deinen Zahlungen auf.',
  },
];
