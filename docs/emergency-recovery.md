# Emergency recovery

Keep this page **with** your Recovery Kit. The file is your vault. This page is
how you put it back together if the Vaulted app or servers are gone.

You should not need this for a lost phone while Vaulted still works. Use the
normal app first.

---

## Is Vaulted still working?

If you can still open the app, open it → Recovery. Stop here.

---

## What you should have saved

| Item | What it is |
| --- | --- |
| Recovery Kit (the zip or JSON) | Map of your vault, plus a **locked** copy of this phone’s key |
| How to recover note | Saved next to the kit (included in the zip) |
| This phone’s passkey | Face ID, Touch ID, or device PIN for the site you enrolled on |
| Hardware key | Required to move ordinary savings |
| Recovery key | Only if you chose Advanced |

The kit is **not** a seed phrase. It cannot spend by itself. An older map-only
file cannot unlock with Face ID if Vaulted is gone. Save a new kit from the app
while it still works.

---

## What you need to spend

- **Ordinary savings:** this phone **and** hardware. No wait.
- **A recovery that already started:** wait, then claim with the key that
  started it (about an hour to two days, depending which key).
- **Bitcoin still arriving into spending:** this phone, after about **90 days**.
- **Fast spending:** not with the phone alone. After a delay you still need two
  keys (phone + hardware, or hardware + recovery on Advanced).

Starting a *new* waiting period still needs Vaulted. If we are already gone,
you cannot start one. You can only finish one that already began, or use the
paths above.

---

## If Vaulted is gone

### 1. Preferred: the phone that enrolled

1. Open the same site you enrolled on (`rc.getvaulted.xyz` or
   `app.getvaulted.xyz`).
2. Choose **Open a Recovery Kit**.
3. Choose your Recovery Kit file.
4. Choose **Use this kit on this device**.
5. Approve with Face ID when asked.
6. Follow Recovery in the app. Hardware signing is still a file you pass to
   your hardware device — the app will not ask for that secret.

If that site will not load, a copy of the app already installed on this phone
may still open. A brand-new phone with no passkey cannot unlock the kit.

### 2. Laptop, if the phone and the real website are both gone

The passkey only speaks to **that website name**. A laptop can pretend to be
that name on purpose, using a copy of the emergency page you already trust:

1. Clone [vaulted-emergency-recovery](https://github.com/brg444/vaulted-emergency-recovery)
   from a source you already trust. Do not download a random “Vaulted recovery”
   app. A Vaulted checkout you already trust also has this page at
   `tools/offline-recovery`.
2. Double-click **Recover.command** (Mac), or run `bun serve.ts` (or
   `pnpm recover:local` from this wallet).
3. If Face ID will not run, this page is using the **wrong website name**.
   Point the enrolled name at this computer, then open that name in the
   browser.
4. Choose your kit, Face ID. Ordinary savings still need hardware.

This is not a bypass. Someone still needs your passkey and your face or PIN.
Do this on a machine you do not use every day. Remove the name mapping when you
are done.

---

## What the kit contains

- Which website name the passkey belongs to
- Addresses and waiting times for savings and recovery
- A locked copy of this phone’s key

It does **not** contain the hardware key, the recovery key, or Vaulted’s
co-signing key. Stolen kit without your passkey is a locked file.

---

## What this cannot do

- Replace a deleted passkey
- Replace lost hardware
- Spend ordinary savings with the phone alone
- Start a new recovery clock after Vaulted is gone
- Make a random new app store listing pretend to be your enrolled site

Standard protection has no recovery key. If you lose hardware and Vaulted
while savings never entered a waiting period, those coins can get stuck.
Advanced is the extra way out.

---

## How to keep this healthy

1. Save the Recovery Kit **outside** the phone (and a second copy).
2. Keep the **How to recover** note next to that file (the zip already includes
   it).
3. After any new enroll, save a **new** kit. Old kits do not follow a new
   passkey.
4. If the app can still open, prefer that over this emergency path.
