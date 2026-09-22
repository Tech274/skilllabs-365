import {
  Code2, NotebookPen, BarChart3, Database, Plug, Cloud, ShieldAlert,
  PenTool, Brain, AppWindow, type LucideIcon,
} from "lucide-react";

export const WORKSPACE_CATEGORIES = [
  "Developer",
  "Notebooks",
  "Analytics / BI",
  "Database / SQL",
  "API / Testing",
  "Cloud / DevOps",
  "Security",
  "Productivity / Design",
  "Data / AI",
  "Other",
] as const;

export type WorkspaceCategory = (typeof WORKSPACE_CATEGORIES)[number];

export const DEFAULT_WORKSPACE_EMAIL_DOMAIN = "skillbridge365.co.in";

export const DEFAULT_USERNAME_PLACEHOLDER = "Learner email / workspace username";
export const DEFAULT_PASSWORD_PLACEHOLDER = "Learner password / platform password";
/**
 * A workspace login field only counts as real when an admin replaced the
 * generic catalogue placeholder text with an actual ID.
 */
export function isRealWorkspaceCredential(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  return trimmed !== DEFAULT_USERNAME_PLACEHOLDER && trimmed !== DEFAULT_PASSWORD_PLACEHOLDER;
}

export const DEFAULT_LOGIN_BINDING_NOTE =
  "Use the generated workspace email, SSO, or admin-provisioned credentials. Bind the external workspace login back to the learner profile after signup.";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Developer: Code2,
  Notebooks: NotebookPen,
  "Analytics / BI": BarChart3,
  "Database / SQL": Database,
  "API / Testing": Plug,
  "Cloud / DevOps": Cloud,
  Security: ShieldAlert,
  "Productivity / Design": PenTool,
  "Data / AI": Brain,
  Other: AppWindow,
};

export const CATEGORY_COLORS: Record<string, string> = {
  Developer: "#3b82f6",
  Notebooks: "#f97316",
  "Analytics / BI": "#14b8a6",
  "Database / SQL": "#8b5cf6",
  "API / Testing": "#eab308",
  "Cloud / DevOps": "#06b6d4",
  Security: "#ef4444",
  "Productivity / Design": "#ec4899",
  "Data / AI": "#22c55e",
  Other: "#64748b",
};

export function workspaceIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? AppWindow;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function iconLabel(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Repeatable per-user, per-application alias: {learner}.{app}@{domain} */
export function buildWorkspaceEmail(
  learnerIdentity: string,
  appSlug: string,
  domain: string = DEFAULT_WORKSPACE_EMAIL_DOMAIN,
): string {
  const learner = slugify(learnerIdentity.split("@")[0] || "learner") || "learner";
  return `${learner}.${slugify(appSlug) || "workspace"}@${domain.replace(/^@/, "")}`;
}

export interface WorkspaceSeed {
  name: string;
  category: WorkspaceCategory;
  description: string;
  launch_url: string;
  workspace_email_enabled: boolean;
  trial_signup_url?: string;
}

const S = (
  category: WorkspaceCategory,
  rows: Array<[name: string, url: string, description: string, trial?: string]>,
): WorkspaceSeed[] =>
  rows.map(([name, url, description, trial]) => ({
    name,
    category,
    description,
    launch_url: url,
    workspace_email_enabled: Boolean(trial),
    trial_signup_url: trial,
  }));

export const DEFAULT_WORKSPACE_CATALOG: WorkspaceSeed[] = [
  ...S("Developer", [
    ["VS Code Web", "https://vscode.dev", "Full VS Code editor in the browser."],
    ["GitHub Codespaces", "https://github.com/codespaces", "Cloud dev containers backed by GitHub.", "https://github.com/codespaces"],
    ["Gitpod", "https://gitpod.io/workspaces", "Ephemeral cloud development environments.", "https://gitpod.io/login"],
    ["Eclipse Che", "https://che.eclipse.org", "Kubernetes-native developer workspaces."],
    ["StackBlitz", "https://stackblitz.com", "Instant fullstack web IDE.", "https://stackblitz.com/register"],
    ["CodeSandbox", "https://codesandbox.io/s", "Cloud sandboxes for web projects.", "https://codesandbox.io/signin"],
    ["Replit", "https://replit.com", "Collaborative browser IDE and hosting.", "https://replit.com/signup"],
    ["Theia IDE", "https://theia-ide.org/#theiaide", "Open-source cloud and desktop IDE."],
    ["OpenVSCode Server", "https://github.com/gitpod-io/openvscode-server", "Self-hosted VS Code server."],
    ["Code-Server", "https://coder.com/docs/code-server", "Run VS Code on any machine, use in browser."],
  ]),
  ...S("Notebooks", [
    ["JupyterLab", "https://jupyter.org/try-jupyter/lab/", "Interactive notebooks for data work."],
    ["JupyterLite", "https://jupyterlite.github.io/demo", "Serverless Jupyter running in the browser."],
    ["Google Colab", "https://colab.research.google.com", "Hosted notebooks with free GPUs."],
    ["Apache Zeppelin", "https://zeppelin.apache.org", "Multi-language data analytics notebooks."],
    ["RStudio / Posit Workbench", "https://posit.co/products/enterprise/workbench/", "Managed R and Python workbench.", "https://posit.co/products/enterprise/workbench/"],
    ["Observable Notebooks", "https://observablehq.com", "Reactive JavaScript data notebooks.", "https://observablehq.com/signup"],
    ["Deepnote", "https://deepnote.com", "Collaborative data science notebooks.", "https://deepnote.com/sign-up"],
    ["Kaggle Notebooks", "https://www.kaggle.com/code", "Notebooks with datasets and GPUs.", "https://www.kaggle.com/account/login"],
    ["SageMaker Studio Lab", "https://studiolab.sagemaker.aws", "Free AWS ML notebook environment.", "https://studiolab.sagemaker.aws/requestAccount"],
  ]),
  ...S("Analytics / BI", [
    ["Apache Superset", "https://superset.apache.org", "Open-source BI and data exploration."],
    ["Metabase", "https://www.metabase.com", "Self-service analytics and dashboards.", "https://store.metabase.com/checkout"],
    ["Grafana", "https://grafana.com/products/cloud/", "Observability dashboards and alerting.", "https://grafana.com/auth/sign-up/create-user"],
    ["Redash", "https://redash.io", "Query, visualize and share data."],
    ["Evidence", "https://evidence.dev", "Code-based BI reports from SQL and markdown."],
    ["RStudio / Posit Cloud", "https://posit.cloud", "R and Python analysis in the cloud.", "https://posit.cloud/plans"],
    ["Power BI", "https://app.powerbi.com", "Microsoft business intelligence service.", "https://powerbi.microsoft.com/en-us/getting-started-with-power-bi/"],
    ["Tableau Cloud", "https://online.tableau.com", "Hosted Tableau analytics.", "https://www.tableau.com/products/trial"],
  ]),
  ...S("Database / SQL", [
    ["Adminer", "https://www.adminer.org", "Lightweight database management UI."],
    ["pgAdmin", "https://www.pgadmin.org", "PostgreSQL administration console."],
    ["CloudBeaver", "https://cloudbeaver.io", "Browser-based database manager."],
    ["DBeaver Cloud", "https://dbeaver.com/cloud/", "Hosted DBeaver team workspace.", "https://dbeaver.com/cloud/"],
    ["SQLPad", "https://getsqlpad.com", "Web SQL editor for many engines."],
    ["Datasette", "https://datasette.io", "Explore and publish SQLite data."],
    ["NocoDB", "https://app.nocodb.com", "Open-source Airtable alternative.", "https://app.nocodb.com/#/signup"],
    ["Baserow", "https://baserow.io", "No-code database platform.", "https://baserow.io/signup"],
  ]),
  ...S("API / Testing", [
    ["Hoppscotch", "https://hoppscotch.io", "Fast open-source API client."],
    ["Postman Web", "https://web.postman.co", "API workspaces and collections.", "https://identity.getpostman.com/signup"],
    ["Insomnia", "https://insomnia.rest", "REST, GraphQL and gRPC client.", "https://app.insomnia.rest/app/authorize"],
    ["Swagger Editor", "https://editor.swagger.io", "Design and validate OpenAPI specs."],
    ["GraphiQL", "https://graphql.org/swapi-graphql", "Interactive GraphQL IDE."],
    ["Apollo Sandbox", "https://studio.apollographql.com/sandbox/explorer", "GraphQL schema explorer."],
  ]),
  ...S("Cloud / DevOps", [
    ["AWS CloudShell", "https://console.aws.amazon.com/cloudshell", "Browser shell with AWS CLI."],
    ["Azure Cloud Shell", "https://shell.azure.com", "Browser shell with Azure CLI."],
    ["Google Cloud Shell", "https://shell.cloud.google.com", "Browser shell with gcloud."],
    ["Kubernetes Dashboard", "https://kubernetes.io/docs/tasks/access-application-cluster/web-ui-dashboard/", "Cluster workloads UI."],
    ["Argo CD", "https://argo-cd.readthedocs.io", "GitOps continuous delivery console."],
    ["Jenkins", "https://www.jenkins.io", "Automation and CI server."],
    ["GitLab Web IDE", "https://gitlab.com/-/ide", "Edit repositories in the browser.", "https://gitlab.com/users/sign_up"],
    ["Terraform Cloud", "https://app.terraform.io", "Managed Terraform runs and state.", "https://app.terraform.io/signup/account"],
  ]),
  ...S("Security", [
    ["OWASP Juice Shop", "https://demo.owasp-juice.shop", "Deliberately insecure web app."],
    ["DVWA", "https://github.com/digininja/DVWA", "Damn Vulnerable Web Application."],
    ["WebGoat", "https://owasp.org/www-project-webgoat/", "OWASP hands-on security lessons."],
    ["CyberChef", "https://gchq.github.io/CyberChef/", "Cyber swiss-army knife for data."],
    ["Wazuh", "https://wazuh.com", "Open-source XDR and SIEM."],
    ["Security Onion", "https://securityonion.net", "Threat hunting and monitoring suite."],
    ["TheHive", "https://strangebee.com/thehive/", "Security incident response platform."],
    ["OpenCTI", "https://demo.opencti.io", "Cyber threat intelligence platform."],
  ]),
  ...S("Productivity / Design", [
    ["Excalidraw", "https://excalidraw.com", "Hand-drawn style whiteboard."],
    ["diagrams.net", "https://app.diagrams.net", "Diagramming and architecture drawings."],
    ["Penpot", "https://design.penpot.app", "Open-source design and prototyping.", "https://design.penpot.app/#/auth/register"],
    ["AppFlowy", "https://appflowy.com", "Open-source workspace for notes and tasks.", "https://appflowy.com/download"],
    ["Etherpad", "https://etherpad.org", "Real-time collaborative text editor."],
    ["HedgeDoc", "https://demo.hedgedoc.org", "Collaborative markdown notes."],
    ["draw.io", "https://www.draw.io", "Classic draw.io diagram editor."],
    ["Figma / FigJam", "https://www.figma.com/files", "Design and whiteboard collaboration.", "https://www.figma.com/signup"],
  ]),
  ...S("Data / AI", [
    ["MLflow", "https://mlflow.org", "Experiment tracking and model registry."],
    ["Label Studio", "https://labelstud.io", "Data labeling for any data type.", "https://app.humansignal.com/user/signup"],
    ["Hugging Face Spaces", "https://huggingface.co/spaces", "Hosted ML demos and apps.", "https://huggingface.co/join"],
    ["Open WebUI", "https://openwebui.com", "Self-hosted chat UI for LLMs."],
    ["Langflow", "https://www.langflow.org", "Visual builder for LLM workflows.", "https://astra.datastax.com/signup"],
    ["Flowise", "https://flowiseai.com", "Drag-and-drop LLM orchestration.", "https://flowiseai.com/"],
    ["Dify", "https://cloud.dify.ai", "LLM app development platform.", "https://cloud.dify.ai/signin"],
    ["Weaviate Console", "https://console.weaviate.cloud", "Vector database console.", "https://console.weaviate.cloud"],
    ["Qdrant Dashboard", "https://cloud.qdrant.io", "Vector search cluster dashboard.", "https://cloud.qdrant.io/login"],
  ]),
];
