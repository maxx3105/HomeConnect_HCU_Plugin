/**
 * Automatische Scope-Ermittlung.
 *
 * Ablauf:
 * 1. Erster Auth mit Minimal-Scope (IdentifyAppliance)
 * 2. GET /api/homeappliances → Gerätetypen ermitteln
 * 3. Scopes aus Gerätetypen ableiten
 * 4. Token neu holen mit vollen Scopes
 * 5. Vollständige Scopes in config.json cachen
 */

const MINIMAL_SCOPE = "IdentifyAppliance";

/** Home Connect Appliance Type → OAuth Scope */
const TYPE_TO_SCOPE = {
  Dishwasher:    "Dishwasher",
  Washer:        "Washer",
  Dryer:         "Dryer",
  WasherDryer:   "WasherDryer",
  Oven:          "Oven",
  CoffeeMaker:   "CoffeeMaker",
  Hood:          "Hood",
  Hob:           "Hob",
  CookProcessor: "CookProcessor",
  CleaningRobot: "CleaningRobot",
  Refrigerator:  "Refrigerator",
  Freezer:       "Freezer",
  FridgeFreezer: "FridgeFreezer",
  WineCooler:    "WineCooler",
};

/**
 * Leitet die benötigten Scopes aus den vorhandenen Geräten ab.
 * @param {Array} appliances - Liste von HC-Appliances
 * @returns {string} Space-separierte Scope-Liste
 */
export function scopesFromAppliances(appliances) {
  const scopes = new Set(["IdentifyAppliance", "Monitor", "Control", "Settings"]);
  for (const app of appliances) {
    const scope = TYPE_TO_SCOPE[app.type];
    if (scope) scopes.add(scope);
  }
  return [...scopes].join(" ");
}

export { MINIMAL_SCOPE };
