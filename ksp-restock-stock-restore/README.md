# Restock Stock-Restore patch

Restores a hand-picked set of parts to their **stock** models and textures while
keeping **Restock 1.5.1** installed for everything else.

## Install

Copy the `StockRestore` folder into your KSP `GameData` directory:

```
Kerbal Space Program/
└── GameData/
    ├── ReStock/            (already there, from CKAN)
    ├── ModuleManager.*.dll (already there)
    └── StockRestore/       <-- copy this in
        ├── StockRestore.cfg
        └── StockRestore.restockwhitelist
```

(In this repo the folder lives at `ksp-restock-stock-restore/GameData/StockRestore/`.)

Then launch KSP. ModuleManager will apply the patch on load (a "reloading
database" prompt may appear the first time). Done — the listed parts render with
stock art, everything else stays Restock.

To undo for any single part, delete its line from `StockRestore.cfg`.

## How it works

Every Restock art patch is written as
`@PART[...]:HAS[~RestockIgnore[*]]:FOR[000_ReStock]` — i.e. Restock skips any
part that carries a `RestockIgnore` field. This is Restock's own supported
opt-out flag.

1. **`StockRestore.cfg`** adds `RestockIgnore = True` to each chosen part in the
   `:BEFORE[000_ReStock]` pass, so Restock's model/texture swap never runs for
   it — the full stock model, textures, and variants are left intact.
2. **`StockRestore.restockwhitelist`** re-enables the stock art assets Restock
   would otherwise blacklist, so the stock models/textures actually load.

> **Whitelist gotcha:** in a `.restockwhitelist` file, comments must be on their
> own line. A `// comment` placed *after* a path on the same line makes Restock
> read the whole line as the path, so it matches nothing and that part fails to
> load ("missing part"). Keep asset paths on bare lines.

Because it only sets a flag and whitelists stock assets, it does **not** edit any
Restock file and survives Restock/CKAN updates.

## Parts restored to stock

| Part | Internal name |
|------|---------------|
| Mk1 Command Pod | `mk1pod_v2` |
| Probodobodyne HECS2 | `HECS2_ProbeCore` |
| RC-001S Remote Guidance Unit | `probeStackSmall` |
| RC-L01 Remote Guidance Unit | `probeStackLarge` |
| IX-6315 "Dawn" Electric Propulsion System | `ionEngine` |
| LV-909 "Terrier" | `liquidEngine3_v2` |
| LV-T30 "Reliant" | `liquidEngine_v2` |
| LV-T45 "Swivel" | `liquidEngine2_v2` |
| RE-L10 "Poodle" | `liquidEngine2-2_v2` |
| RE-M3 "Mainsail" | `liquidEngineMainsail_v2` |
| RE-I5 "Skipper" | `engineLargeSkipper_v2` |
| Kerbodyne KR-2L+ "Rhino" | `Size3AdvancedEngine` |
| S3 KS-25 "Vector" | `SSME` |
| KR-1 "Mastodon" (KE-1) | `LiquidEngineKE-1` |
| RE-J10 "Wolfhound" | `LiquidEngineRE-J10` |
| RT-5 "Flea" SRB | `solidBooster_sm_v2` |
| RT-10 "Hammer" SRB | `solidBooster_v2` |
| BACC "Thumper" SRB | `solidBooster1-1` |
| S1 SRB-KD25k "Kickback" SRB | `MassiveBooster` |
| Sepratron I | `sepMotor1` |
| "Mite" SRB | `Mite` |
| "Shrimp" SRB | `Shrimp` |
| "Thoroughbred" SRB | `Thoroughbred` |
| "Clydesdale" SRB | `Clydesdale` |
| Clamp-O-Tron Docking Port | `dockingPort2` |
| Clamp-O-Tron Jr. | `dockingPort3` |
| Clamp-O-Tron Sr. | `dockingPortLarge` |
| RoveMax Model S2 | `roverWheel2` |
| Communotron 88-88 | `commDish` |
| Communotron HG-55 | `HighGainAntenna` |
| HG-5 High Gain Antenna | `HighGainAntenna5_v2` |
| RA-2 Relay Antenna | `RelayAntenna5` |
| SC-9001 Science Jr. | `science_module` |
| Kerbodyne S3-3600 Tank | `Size3SmallTank` |
| Kerbodyne S3-7200 Tank | `Size3MediumTank` |
| Kerbodyne S3-14400 Tank | `Size3LargeTank` |
| Kerbodyne S4-64 Fuel Tank | `Size4_Tank_01` |
| Kerbodyne S4-128 Fuel Tank | `Size4_Tank_02` |
| Kerbodyne S4-256 Fuel Tank | `Size4_Tank_03` |
| Kerbodyne S4-512 Fuel Tank | `Size4_Tank_04` |
| Kerbodyne S3-S4 Adapter Tank | `Size3_Size4_Adapter_01` |
| Kerbodyne Engine Cluster Adapter Tank | `Size4_EngineAdapter_01` |

## Notes

- **"RoveMax Model XL3"** (`roverWheelXL3`) and **"Kerbodyne ADTP-2-3"** are not
  modified by Restock in the first place, so they are already stock — no entry is
  needed and none was added.
- The Making History parts (Wolfhound, Mastodon, and the S4 Kerbodyne tanks)
  aren't in Restock's blacklist, so they need only the `RestockIgnore` flag, no
  whitelist line. If you don't have the Making History expansion, those `.cfg`
  lines simply do nothing — they're harmless.
- The `DirectAntennas` and `RelayAntennas` folders are shared by several
  antennas; whitelisting them reloads a couple of stock assets for antennas you
  didn't ask to restore. Those antennas still use their Restock models — only the
  four antennas listed above are actually reverted. The effect is negligible
  (a few KB of extra textures).
- The Launch Escape System uses solid fuel but isn't a booster, so it was left on
  Restock. Add `@PART[LaunchEscapeSystem]:BEFORE[000_ReStock] { %RestockIgnore = True }`
  if you want it stock too.
