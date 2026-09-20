import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";

const tabs = [
  { label: "Status", url: "/admin/provisioning-status" },
  { label: "Retries", url: "/admin/provisioning-retries" },
  { label: "Export", url: "/admin/provisioning-export" },
];

export function ProvisioningAdminTabs() {
  return (
    <nav aria-label="Provisioning views" className="flex w-fit items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
      {tabs.map((tab) => (
        <Button key={tab.url} variant="ghost" size="sm" asChild className="h-7 px-3 data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm">
          <NavLink to={tab.url} end activeClassName="bg-background text-foreground shadow-sm" className="text-muted-foreground">
            {tab.label}
          </NavLink>
        </Button>
      ))}
    </nav>
  );
}
