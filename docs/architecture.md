# How the pieces fit

Three repos. Two processes.

```text
this phone
   talks to /v1 on the same website
      → vault service
           keeps a database
           holds the service key
           calls a public Arkade signer for the other signature
```

| Piece | Repo | Job |
| --- | --- | --- |
| Phone app | this repo | What you tap. Builds the same trees the service does |
| Vault service | [arkade-vault-server](https://github.com/brg444/arkade-vault-server) | Checks spends. Signs daily spend. Cannot take Savings |
| Script engine | [arkade-2fa-vault-poc](https://github.com/brg444/arkade-2fa-vault-poc) `pkg/arkade` | Opcodes only |

The phone app never has the service’s URL baked in. The website in
front adds a shared secret. You need an invite to enroll.

The service builds its own copy of the vault from the keys it stored.
It checks the spend against that copy.

After a recovery wait is over, moving the coins does not need the
service.

Live is Mutinynet. No mainnet.
