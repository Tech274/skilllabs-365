import { AlertCircle, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseProvisioningError } from "@/lib/provisioning-errors";

interface Props {
  message: string;
  payload?: { missing_fields?: string[]; setting?: string; suggestion?: string } | null;
  /** Show the admin deep link (admins/instructors only). */
  canAdminister?: boolean;
  compact?: boolean;
}

export function ProvisioningErrorPanel({ message, payload, canAdminister, compact }: Props) {
  const hint = parseProvisioningError(message, payload);

  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/10 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-xs font-medium text-destructive">{hint.title}</p>
          <p className="text-[11px] leading-tight text-destructive/80">{hint.detail}</p>
        </div>
      </div>

      {hint.fields.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {hint.fields.map((f) => (
            <Badge key={f.key} variant="outline" className="text-[10px] border-destructive/40 text-destructive">
              {f.label}
            </Badge>
          ))}
        </div>
      )}

      {!compact && (
        <ol className="pl-6 space-y-0.5 list-decimal list-inside text-[11px] text-muted-foreground">
          {hint.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      )}

      {canAdminister && hint.adminPath && (
        <div className="pl-6">
          <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]">
            <Link to={hint.adminPath}>
              <ExternalLink className="h-3 w-3" /> Fix in {hint.adminLabel}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
