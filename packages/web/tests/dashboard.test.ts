import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/svelte";
import DashboardPage from "../src/routes/+page.svelte";
import Sidebar from "../src/components/Sidebar.svelte";
import TopBar from "../src/components/TopBar.svelte";
import { ApiClient, ApiError } from "../src/lib/api.js";
import {
  decodeToken,
  createMockToken,
  getVisibleNavItems,
  hasMinRole,
} from "../src/lib/auth.js";
import type { DashboardMetrics, ComplianceItem, ActivityEvent } from "../src/lib/types.js";

// ─── Test data ───────────────────────────────────────────────────────

const MOCK_METRICS: DashboardMetrics = {
  activeContracts: 42,
  totalCeiling: 150000000,
  totalFunded: 87500000,
  pendingActions: 7,
};

const MOCK_COMPLIANCE: ComplianceItem[] = [
  {
    id: "comp-1",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    milestoneName: "Monthly Status Report",
    dueDate: "2026-02-20",
    status: "PENDING",
  },
  {
    id: "comp-2",
    contractId: "c-2",
    contractNumber: "N00024-23-C-5500",
    milestoneName: "Deliverable Review",
    dueDate: "2026-02-22",
    status: "PENDING",
  },
];

const MOCK_OVERDUE: ComplianceItem[] = [
  {
    id: "comp-overdue-1",
    contractId: "c-1",
    contractNumber: "FA8726-24-C-0042",
    milestoneName: "Quarterly Report",
    dueDate: "2026-02-10",
    status: "PENDING",
  },
];

const MOCK_ACTIVITY: ActivityEvent[] = [
  {
    id: "evt-1",
    agentType: "contract_ingestion",
    taskId: "task-001",
    status: "SUCCESS",
    inputSummary: { contractId: "c-1" },
    createdAt: "2026-02-19T10:00:00Z",
  },
  {
    id: "evt-2",
    agentType: "clause_analysis",
    taskId: "task-002",
    status: "RUNNING",
    inputSummary: { contractId: "c-2" },
    createdAt: "2026-02-19T09:30:00Z",
  },
  {
    id: "evt-3",
    agentType: "compliance_monitor",
    taskId: "task-003",
    status: "FAILURE",
    inputSummary: {},
    createdAt: "2026-02-19T09:00:00Z",
  },
];

const MOCK_USER = {
  userId: "user-001",
  email: "admin@dynamo.com",
  name: "Admin User",
  role: "admin" as const,
};

// ─── Dashboard rendering tests ───────────────────────────────────────

describe("Dashboard page", () => {
  it("renders key metric cards", () => {
    render(DashboardPage, {
      props: {
        data: {
          metrics: MOCK_METRICS,
          complianceDue: [],
          overdueItems: [],
          activity: [],
        },
      },
    });

    const activeCard = screen.getByTestId("metric-active-contracts");
    expect(activeCard).toBeInTheDocument();
    expect(activeCard.textContent).toContain("42");
    expect(activeCard.textContent).toContain("Active Contracts");

    const ceilingCard = screen.getByTestId("metric-total-ceiling");
    expect(ceilingCard).toBeInTheDocument();
    expect(ceilingCard.textContent).toContain("$150,000,000");

    const fundedCard = screen.getByTestId("metric-total-funded");
    expect(fundedCard).toBeInTheDocument();
    expect(fundedCard.textContent).toContain("$87,500,000");

    const pendingCard = screen.getByTestId("metric-pending-actions");
    expect(pendingCard).toBeInTheDocument();
    expect(pendingCard.textContent).toContain("7");
  });

  it("shows upcoming compliance deadlines", () => {
    render(DashboardPage, {
      props: {
        data: {
          metrics: MOCK_METRICS,
          complianceDue: MOCK_COMPLIANCE,
          overdueItems: MOCK_OVERDUE,
          activity: [],
        },
      },
    });

    const section = screen.getByTestId("compliance-section");
    expect(section).toBeInTheDocument();

    const dueItems = screen.getAllByTestId("compliance-item");
    expect(dueItems.length).toBe(2);
    expect(dueItems[0]!.textContent).toContain("Monthly Status Report");

    const overdueItems = screen.getAllByTestId("overdue-item");
    expect(overdueItems.length).toBe(1);
    expect(overdueItems[0]!.textContent).toContain("Quarterly Report");

    expect(section.textContent).toContain("1 Overdue");
    expect(section.textContent).toContain("2 Due This Week");
  });

  it("renders activity feed events", () => {
    render(DashboardPage, {
      props: {
        data: {
          metrics: MOCK_METRICS,
          complianceDue: [],
          overdueItems: [],
          activity: MOCK_ACTIVITY,
        },
      },
    });

    const section = screen.getByTestId("activity-section");
    expect(section).toBeInTheDocument();

    const events = screen.getAllByTestId("activity-event");
    expect(events.length).toBe(3);

    expect(events[0]!.textContent).toContain("contract ingestion");
    expect(events[0]!.textContent).toContain("SUCCESS");
    expect(events[1]!.textContent).toContain("clause analysis");
    expect(events[2]!.textContent).toContain("compliance monitor");
  });
});

// ─── Navigation tests ────────────────────────────────────────────────

describe("Navigation", () => {
  it("renders all navigation links for admin user", () => {
    render(Sidebar, {
      props: {
        role: "admin",
        currentPath: "/",
        open: true,
      },
    });

    const nav = screen.getByTestId("nav");
    expect(nav).toBeInTheDocument();

    expect(screen.getByTestId("nav-link-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-contracts")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-compliance")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-subcontracts")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-requests")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-search")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-agents")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-playbook")).toBeInTheDocument();
    expect(screen.getByTestId("nav-link-reports")).toBeInTheDocument();
  });

  it("hides restricted sections from viewer role", () => {
    const viewerNav = getVisibleNavItems("viewer");
    const labels = viewerNav.map((n) => n.label);

    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Contracts");
    expect(labels).toContain("Search");

    expect(labels).not.toContain("Agents");
    expect(labels).not.toContain("Playbook");
  });

  it("shows user info in the top bar", () => {
    render(TopBar, {
      props: {
        user: MOCK_USER,
        pageTitle: "Dashboard",
      },
    });

    const userInfo = screen.getByTestId("user-info");
    expect(userInfo).toBeInTheDocument();
    expect(userInfo.textContent).toContain("Admin User");
  });
});

// ─── Auth tests ──────────────────────────────────────────────────────

describe("Authentication", () => {
  it("unauthenticated user is redirected (token decode returns null)", () => {
    const result = decodeToken("invalid-token");
    expect(result).toBeNull();
  });

  it("decodes a valid mock token", () => {
    const token = createMockToken({
      userId: "user-123",
      email: "test@dynamo.com",
      name: "Test User",
      role: "contracts_manager",
    });

    const user = decodeToken(token);
    expect(user).not.toBeNull();
    expect(user!.userId).toBe("user-123");
    expect(user!.email).toBe("test@dynamo.com");
    expect(user!.name).toBe("Test User");
    expect(user!.role).toBe("contracts_manager");
  });

  it("role hierarchy works correctly", () => {
    expect(hasMinRole("admin", "admin")).toBe(true);
    expect(hasMinRole("admin", "viewer")).toBe(true);
    expect(hasMinRole("viewer", "admin")).toBe(false);
    expect(hasMinRole("contracts_team", "contracts_team")).toBe(true);
    expect(hasMinRole("contracts_team", "contracts_manager")).toBe(false);
    expect(hasMinRole("contracts_manager", "contracts_team")).toBe(true);
  });
});

// ─── API client tests ────────────────────────────────────────────────

describe("API client", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("attaches auth headers to requests", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ activeContracts: 10 }),
    });

    const client = new ApiClient({
      baseUrl: "http://localhost:3000/api/v1",
      token: "my-jwt-token",
    });

    await client.getDashboardMetrics();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://localhost:3000/api/v1/dashboard/metrics");
    expect(init.headers["Authorization"]).toBe("Bearer my-jwt-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("calls onUnauthorized on 401 response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    const onUnauthorized = vi.fn();
    const client = new ApiClient({
      baseUrl: "http://localhost:3000/api/v1",
      token: "expired-token",
      onUnauthorized,
    });

    await expect(client.getDashboardMetrics()).rejects.toThrow(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("throws ApiError with status for non-OK responses", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Internal Server Error" }),
    });

    const client = new ApiClient({ token: "token" });

    try {
      await client.getContracts();
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });
});
