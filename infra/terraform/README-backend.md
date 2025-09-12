## Backend (Remote State)

A minimal `backend.tf` with `backend "s3" {}` is included. At runtime, the script writes `backend.auto.tfbackend` from your environment so you are **not** prompted for values.

From PowerShell:
```powershell
# One-time setup in your env
.\ops\Set-MBEnv.ps1 -TfStateBucket "mbapp-tfstate-nonprod" -TfLockTable "mbapp-terraform-locks" -TfStateKey "mbapp/infra/terraform.tfstate"

# Then run Terraform
.\ops\Tf-PlanApply.ps1
.\ops\Tf-PlanApply.ps1 -Apply
```
