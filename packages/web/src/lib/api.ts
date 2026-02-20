/**
 * Typed API client for the Forge CLM backend.
 * All requests attach the auth token and handle 401 redirects.
 */

import type {
  DashboardMetrics,
  ComplianceItem,
  ActivityEvent,
  ContractSummary,
  ContractDetail,
  ContractClause,
  Modification,
  Deliverable,
  ContractOption,
  Communication,
  FsmTransition,
  PaginatedResponse,
  SearchResult,
  AskResponse,
  OverdueItem,
  FundingStatus,
  OptionWindow,
  CalendarDeadline,
  ContractRequest,
  PlaybookRule,
  AgentRegistryEntry,
  AgentExecution,
  SystemHealth,
  ReportType,
  ReportResult,
} from "./types.js";

export class ApiClient {
  private baseUrl: string;
  private token: string | null;
  private onUnauthorized: (() => void) | null;

  constructor(options?: {
    baseUrl?: string;
    token?: string | null;
    onUnauthorized?: () => void;
  }) {
    this.baseUrl = options?.baseUrl ?? "http://localhost:3000/api/v1";
    this.token = options?.token ?? null;
    this.onUnauthorized = options?.onUnauthorized ?? null;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (response.status === 401) {
      this.onUnauthorized?.();
      throw new ApiError("Unauthorized", 401);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(
        (body as any).error ?? `Request failed: ${response.status}`,
        response.status,
      );
    }

    return response.json() as Promise<T>;
  }

  // ─── Dashboard ──────────────────────────────────────────────────

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    return this.request<DashboardMetrics>("/dashboard/metrics");
  }

  async getComplianceUpcoming(days = 7): Promise<ComplianceItem[]> {
    return this.request<ComplianceItem[]>(
      `/compliance/upcoming?days=${days}`,
    );
  }

  async getComplianceOverdue(): Promise<ComplianceItem[]> {
    return this.request<ComplianceItem[]>("/compliance/overdue");
  }

  async getRecentActivity(limit = 20): Promise<ActivityEvent[]> {
    return this.request<ActivityEvent[]>(
      `/activity/recent?limit=${limit}`,
    );
  }

  // ─── Contracts ──────────────────────────────────────────────────

  async getContracts(
    params?: { page?: number; limit?: number; filter?: string },
  ): Promise<PaginatedResponse<ContractSummary>> {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.filter) query.set("filter", params.filter);
    const qs = query.toString();
    return this.request<PaginatedResponse<ContractSummary>>(
      `/contracts${qs ? `?${qs}` : ""}`,
    );
  }

  async getContract(id: string): Promise<ContractDetail> {
    return this.request<ContractDetail>(`/contracts/${id}`);
  }

  async getContractClauses(id: string): Promise<ContractClause[]> {
    return this.request<ContractClause[]>(`/contracts/${id}/clauses`);
  }

  async getContractMods(id: string): Promise<Modification[]> {
    return this.request<Modification[]>(`/contracts/${id}/mods`);
  }

  async getContractDeliverables(id: string): Promise<Deliverable[]> {
    return this.request<Deliverable[]>(`/contracts/${id}/deliverables`);
  }

  async getContractCompliance(id: string): Promise<ComplianceItem[]> {
    return this.request<ComplianceItem[]>(`/contracts/${id}/compliance`);
  }

  async getContractOptions(id: string): Promise<ContractOption[]> {
    return this.request<ContractOption[]>(`/contracts/${id}/options`);
  }

  async getContractComms(id: string): Promise<Communication[]> {
    return this.request<Communication[]>(`/contracts/${id}/communications`);
  }

  async getContractTransitions(id: string): Promise<FsmTransition[]> {
    return this.request<FsmTransition[]>(`/contracts/${id}/transitions`);
  }

  async getContractHistory(id: string): Promise<unknown[]> {
    return this.request<unknown[]>(`/contracts/${id}/history`);
  }

  async transitionContract(
    id: string,
    toState: string,
  ): Promise<{ id: string; status: string }> {
    return this.request(`/contracts/${id}/transition`, {
      method: "POST",
      body: JSON.stringify({ toState }),
    });
  }

  // ─── Compliance Dashboard ───────────────────────────────────────

  async getOverdueDetailed(): Promise<OverdueItem[]> {
    return this.request<OverdueItem[]>("/compliance/overdue/detailed");
  }

  async getFundingStatus(): Promise<FundingStatus[]> {
    return this.request<FundingStatus[]>("/compliance/funding-status");
  }

  async getOptionWindows(days = 90): Promise<OptionWindow[]> {
    return this.request<OptionWindow[]>(
      `/compliance/option-windows?days=${days}`,
    );
  }

  async getComplianceCalendar(
    year: number,
    month: number,
  ): Promise<CalendarDeadline[]> {
    return this.request<CalendarDeadline[]>(
      `/compliance/calendar?year=${year}&month=${month}`,
    );
  }

  // ─── Requests ──────────────────────────────────────────────────

  async getRequests(): Promise<ContractRequest[]> {
    return this.request<ContractRequest[]>("/requests");
  }

  async createRequest(
    data: Omit<ContractRequest, "id" | "status" | "submittedAt">,
  ): Promise<ContractRequest> {
    return this.request<ContractRequest>("/requests", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateRequestStatus(
    id: string,
    status: string,
  ): Promise<ContractRequest> {
    return this.request<ContractRequest>(`/requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  // ─── Playbook Rules ───────────────────────────────────────────

  async getPlaybookRules(): Promise<PlaybookRule[]> {
    return this.request<PlaybookRule[]>("/playbook/rules");
  }

  async createPlaybookRule(
    data: Omit<PlaybookRule, "id">,
  ): Promise<PlaybookRule> {
    return this.request<PlaybookRule>("/playbook/rules", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updatePlaybookRule(
    id: string,
    data: Partial<PlaybookRule>,
  ): Promise<PlaybookRule> {
    return this.request<PlaybookRule>(`/playbook/rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async reorderPlaybookRules(
    orderedIds: string[],
  ): Promise<{ success: boolean }> {
    return this.request("/playbook/rules/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds }),
    });
  }

  // ─── Search / Ask ───────────────────────────────────────────────

  async search(
    query: string,
    filters?: {
      contractId?: string;
      sectionType?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<SearchResult[]> {
    return this.request<SearchResult[]>("/search", {
      method: "POST",
      body: JSON.stringify({ query, ...filters }),
    });
  }

  async ask(
    question: string,
    contractId?: string,
  ): Promise<AskResponse> {
    return this.request<AskResponse>("/ask", {
      method: "POST",
      body: JSON.stringify({ question, contract_id: contractId }),
    });
  }

  // ─── Agent Monitor ──────────────────────────────────────────────

  async getAgentRegistry(): Promise<AgentRegistryEntry[]> {
    return this.request<AgentRegistryEntry[]>("/agents");
  }

  async getAgentExecutions(agentId: string): Promise<AgentExecution[]> {
    return this.request<AgentExecution[]>(`/agents/${agentId}/executions`);
  }

  async getSystemHealth(): Promise<SystemHealth> {
    return this.request<SystemHealth>("/system/health");
  }

  async triggerAgent(agentId: string): Promise<AgentExecution> {
    return this.request<AgentExecution>(`/agents/${agentId}/trigger`, {
      method: "POST",
    });
  }

  // ─── Reports ────────────────────────────────────────────────────

  async generateReport(
    type: ReportType,
    startDate: string,
    endDate: string,
  ): Promise<ReportResult> {
    return this.request<ReportResult>("/reports/generate", {
      method: "POST",
      body: JSON.stringify({ type, startDate, endDate }),
    });
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
