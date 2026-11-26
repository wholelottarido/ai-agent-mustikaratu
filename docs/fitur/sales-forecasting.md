# IMPLEMENTATION PLAN: SALES FORECASTING ENGINE

## Project: Mustika Ratu Enterprise AI Agent

**Repository:** https://github.com/wholelottarido/ai-agent-mustikaratu

**Focus:** Internal Sales Forecasting using PostgreSQL, TypeScript, AutoARIMA, and VoltAgent.

**Phase:** 1 — Sales Forecasting Only

**Future Phase:** Market Trend Intelligence / Web Search (not included in this implementation).

---

# 1. Objective

Implement a Sales Forecasting Engine within the existing Mustika Ratu AI Agent platform.

The system must be capable of:

1. Retrieving historical product sales from the existing PostgreSQL database.
2. Preparing sales data into a valid time-series dataset.
3. Training/fitting a forecasting model using historical sales data.
4. Predicting future product sales at monthly frequency.
5. Evaluating prediction accuracy using historical backtesting.
6. Returning structured forecasting results.
7. Integrating the forecasting functionality into the existing VoltAgent tool-calling architecture.
8. Allowing users to request sales predictions through natural language conversations.

Example user requests:

- "Prediksi penjualan produk X bulan depan."
- "Bagaimana perkiraan penjualan produk X untuk 3 bulan ke depan?"
- "Coba analisis tren penjualan produk X selama 12 bulan terakhir."
- "Berapa estimasi jumlah produk X yang akan terjual pada Desember 2026?"
- "Bandingkan prediksi penjualan produk X dan Y."

The forecasting must be calculated by a statistical model rather than estimated by the LLM itself.

The LLM is responsible only for understanding user requests, calling tools, and explaining the forecasting results.

---

# 2. Important Implementation Rules

Before implementing anything:

1. Read the existing `CLAUDE.md` and `AGENTS.md` instructions.
2. Analyze the existing repository structure and architecture.
3. Identify how PostgreSQL connections are currently configured.
4. Identify existing database source configuration, access controls, and read-only query mechanisms.
5. Identify how VoltAgent tools are declared, registered, and executed.
6. Check how tools are exposed to the web application and WhatsApp bot.
7. Review existing scripts, tests, TypeScript configuration, and dependencies.
8. Reuse the existing architecture and utilities whenever possible.

Do not immediately generate a new database connection or independent agent system.

### Mandatory constraints

- Use TypeScript and Node.js.
- Continue using the existing Next.js and VoltAgent architecture.
- Do not add Python or FastAPI for this phase.
- Do not replace the existing LLM.
- Do not modify unrelated AI Agent functionality.
- Do not break existing tools, authentication, permissions, RAG, or database integrations.
- Do not expose private sales data to external AI services.
- Do not introduce web search, Google Trends, or external market-trend APIs.
- Do not invent actual database table names or columns.
- Do not perform database schema migrations without explicit approval.
- Use read-only access for source sales data.
- Prefer existing database abstractions and query utilities.

If actual PostgreSQL schema access is unavailable, implement against a clearly defined repository interface and provide configuration instructions. Do not claim live database integration has been verified.

---

# 3. Proposed Architecture

The intended forecasting workflow:

```text
USER
 |
 v
Next.js / WhatsApp Interface
 |
 v
Existing AI Agent
 |
 v
VoltAgent Tool Calling
 |
 v
forecast_sales Tool
 |
 v
Sales Forecasting Service (TypeScript)
 |
 +--> PostgreSQL
 |     |
 |     +--> Historical Sales Query
 |     +--> Product Validation
 |     +--> Sales Aggregation
 |
 +--> Data Preprocessing
 |     |
 |     +--> Date Normalization
 |     +--> Missing Period Detection
 |     +--> Data Quality Validation
 |
 +--> Forecasting Engine
 |     |
 |     +--> Naive Baseline
 |     +--> Seasonal Naive Baseline
 |     +--> AutoARIMA
 |
 +--> Model Evaluation
 |     |
 |     +--> Rolling Backtesting
 |     +--> MAE
 |     +--> WAPE
 |     +--> Forecast Bias
 |
 v
Structured Forecast Result
 |
 v
VoltAgent
 |
 v
Natural Language Explanation
 |
 v
USER
```

Keep forecasting model execution separate from LLM reasoning.

---

# 4. Phase 1 — PostgreSQL Schema Discovery

## Goal

Identify the actual sales-related PostgreSQL schema before writing forecasting queries.

Inspect existing database utilities and the currently registered PostgreSQL data sources.

Look for relevant data such as:

- Product or SKU identifiers.
- Product names.
- Transaction/order dates.
- Quantity sold.
- Transaction statuses.
- Product returns and cancellations.
- Sales channels.
- Historical price information.
- Inventory availability, if available.

Check whether sales information is stored as transaction-level records or monthly aggregates.

## Required actions

1. Identify relevant database schemas and tables.
2. Inspect their column definitions and relationships.
3. Identify the authoritative source for completed sales.
4. Confirm how canceled orders, refunds, and returns are represented.
5. Identify potential duplicate transaction records.
6. Determine the earliest and latest available transaction dates.
7. Determine whether product data is available at SKU level.

Use read-only schema inspection and sample queries.

Do not print or expose sensitive customer, employee, or transaction-level information in logs or documentation.

### Deliverable

Create a short schema mapping document:

`docs/forecasting/database-mapping.md`

Include:

- Database source.
- Relevant schemas and tables.
- Required columns.
- Join relationships.
- Transaction filtering rules.
- Sales aggregation logic.
- Known data quality limitations.

If the actual sales tables cannot be identified reliably, stop database-specific implementation and report the missing information.

Do not guess the SQL schema.

---

# 5. Phase 2 — Sales Data Aggregation

## Goal

Transform historical transactions into chronological monthly sales data.

Target internal data structure:

```typescript
interface MonthlySalesRecord {
  productId: string;
  period: string;       // YYYY-MM
  unitsSold: number;
}
```

Example:

```json
[
  {
    "productId": "MR-001",
    "period": "2026-01",
    "unitsSold": 8200
  },
  {
    "productId": "MR-001",
    "period": "2026-02",
    "unitsSold": 9100
  }
]
```

The example data above is synthetic.

### Requirements

- Aggregate historical sales per SKU and month.
- Sort chronologically.
- Use an explicit business timezone and document its choice.
- Include only valid sales transactions.
- Handle cancellations and returns using verified business rules.
- Detect missing months.
- Do not automatically interpret missing database records as zero sales.
- Identify zero-sales periods separately from missing data.
- Detect incomplete current-month data.
- Ensure unit quantities are finite numeric values.
- Exclude test transactions if identifiable.
- Prevent duplicate counting.

### Important

If predicting monthly sales, do not use partial current-month totals as though they represent a complete month.

For the MVP, use the latest complete month as the default training cutoff.

Data completeness and forecast frequency must be explicit.

### Deliverable

Build a reusable TypeScript function similar to:

```typescript
getMonthlySalesHistory({
  productId,
  startPeriod,
  endPeriod,
  sourceId,
  scope
})
```

`sourceId` and `scope` represent authorized data-source and access-scope context. Follow the repository's existing conventions; do not invent a new authorization mechanism.

The function must use parameterized SQL or existing safe database utilities.

---

# 6. Phase 3 — Data Preprocessing

Create a forecasting preprocessing module.

Responsibilities:

1. Validate chronological order.
2. Normalize monthly periods.
3. Validate sales quantities.
4. Detect gaps.
5. Check available historical observations.
6. Check unusually large spikes or drops.
7. Detect series with mostly zero or intermittent demand.
8. Identify insufficient historical data.
9. Prepare numeric arrays for forecasting.

Example output:

```typescript
interface PreparedSalesSeries {
  productId: string;
  periods: string[];
  values: number[];
  startPeriod: string;
  endPeriod: string;
  observationCount: number;
  warnings: string[];
}
```

## Data validation

Do not automatically remove outliers. Large spikes may represent actual sales events, such as promotional campaigns or seasonal demand.

Record anomalies as warnings unless a verified data-quality problem justifies correction.

Products without sufficient data must receive an explicit response indicating that reliable forecasting cannot yet be generated.

Avoid treating 12 months of data as universally sufficient.

If annual seasonality is evaluated, prefer multiple annual cycles.

---

# 7. Phase 4 — Forecasting Models

## Initial implementation

Implement three candidate models:

### Model A — Naive Forecast

Predict that the next month's sales will equal the most recent completed month's sales.

Purpose:

- Baseline comparison.
- Sanity check.
- Fallback when appropriate.

### Model B — Seasonal Naive Forecast

Predict that future sales will resemble the equivalent period from the previous seasonal cycle.

For monthly annual seasonality, use the same month in the previous year.

Only enable this model if sufficient historical data exists.

### Model C — AutoARIMA

Use a compatible Node.js package such as:

```bash
npm install arima
```

Before installation, verify current package compatibility with the repository's Node.js runtime, TypeScript build, module format, and deployment environment.

The package must support:

- Model fitting.
- Forecast generation.
- Automatic ARIMA parameter selection.
- Forecasting multiple periods ahead.

Do not blindly copy sample code if the installed library's API differs.

Wrap the model behind a consistent application interface.

Suggested model interface:

```typescript
interface ForecastModel {
  name: string;

  fit(series: number[]): Promise<void>;

  predict(horizon: number): Promise<number[]>;
}
```

Implement the actual interface based on the library and repository patterns.

## Model selection

Evaluate candidate models using historical backtesting.

Choose the model with the best acceptable performance instead of always selecting AutoARIMA.

Requirements:

- Forecasts must be finite numbers.
- Forecasted sales units cannot be negative in the final output.
- Round unit predictions appropriately.
- Preserve raw predictions internally when needed for evaluation.
- Catch model fitting and prediction failures.
- Avoid using models that cannot handle the available data.
- Never fabricate forecasts when calculation fails.

## Performance

Avoid expensive model fitting inside the event loop if it degrades application responsiveness.

Evaluate worker threads or a background job approach if necessary, while remaining within the existing Node.js architecture.

For the first implementation, prioritize reliable single-product forecasts before optimizing large-scale execution.

---

# 8. Phase 5 — Model Evaluation and Backtesting

## Goal

Verify that the forecasting model performs better than simple baseline methods.

Do not use random train/test splitting.

Use time-based evaluation.

### Implement

- Expanding-window or rolling-origin backtesting.
- MAE (Mean Absolute Error).
- WAPE (Weighted Absolute Percentage Error).
- Forecast Bias.
- Model comparison.

Example:

```text
Historical sales:
Jan 2025 — Sep 2026

Backtest:
Train Jan 2025 — Mar 2026
Predict Apr 2026

Train Jan 2025 — Apr 2026
Predict May 2026

Train Jan 2025 — May 2026
Predict Jun 2026

Continue across eligible periods.
```

Use only information that was historically available at each prediction cutoff.

For multi-month forecasting, evaluate each forecast horizon separately where practical.

Handle zero denominators in WAPE without reporting misleading values.

## Output

```typescript
interface ForecastEvaluation {
  model: string;
  mae: number | null;
  wape: number | null;
  bias: number | null;
  backtestWindows: number;
  status: "passed" | "warning" | "insufficient_data";
}
```

Do not invent a universal accuracy threshold.

If AutoARIMA does not outperform naive approaches, report this honestly and use the better-supported model.

Store the model selection rationale for later inspection.

---

# 9. Phase 6 — Forecasting Service

Implement a reusable forecasting service within the existing Node.js application.

Suggested function:

```typescript
generateSalesForecast({
  productId,
  horizon,
  frequency,
  sourceId,
  scope
})
```

## Input

```typescript
interface SalesForecastRequest {
  productId: string;
  horizon: number;
  frequency: "monthly";
}
```

The service must also receive the authenticated authorization context through the existing server-side mechanism.

Suggested validation:

- Product ID must be valid.
- Horizon must be between 1 and 12 months for the MVP.
- Only monthly forecasting is required for the first version.
- Product must be accessible to the requesting user.
- Historical data must meet model requirements.

## Output

```json
{
  "status": "success",
  "productId": "MR-001",
  "frequency": "monthly",
  "model": "AutoARIMA",
  "trainingPeriod": {
    "start": "2024-01",
    "end": "2026-09"
  },
  "forecast": [
    {
      "period": "2026-10",
      "predictedUnits": 12300
    },
    {
      "period": "2026-11",
      "predictedUnits": 12800
    }
  ],
  "evaluation": {
    "mae": 950,
    "wape": 8.5,
    "bias": 125,
    "backtestWindows": 6
  },
  "warnings": []
}
```

All values in this JSON are illustrative.

Actual output must be generated from the forecasting algorithm and real historical data.

For production responses, use a proper error structure for insufficient data, unavailable databases, unauthorized products, and failed model execution.

Include model version, generation timestamp, and data cutoff as appropriate.

---

# 10. Phase 7 — Integrate with VoltAgent

Create a forecasting tool using the existing VoltAgent tool conventions.

Suggested tool name:

`forecast_sales`

Description:

"Forecast future product sales using verified historical sales data from the internal PostgreSQL database."

Expected parameters:

```typescript
{
  product_id: string;
  horizon: number;
  frequency: "monthly";
}
```

## Requirements

1. Reuse the existing agent registration mechanism.
2. Reuse existing tool authentication and permissions.
3. Resolve user authorization and database source server-side.
4. Call the forecasting service.
5. Return structured forecasting results.
6. Handle failures with useful error messages.
7. Prevent unauthorized access to company sales data.
8. Avoid modifying unrelated agent instructions.
9. Integrate with existing tool routing/discovery if used.

### Agent behavior

When users ask for future sales predictions:

1. Resolve the requested product.
2. Validate user access.
3. Determine the forecast horizon.
4. Call `forecast_sales`.
5. Receive the calculated results.
6. Explain the forecast in Indonesian using clear business language.

The AI Agent must not independently invent sales prediction numbers.

The final explanation should distinguish:

- Actual historical sales.
- Model-generated predictions.
- Evaluation metrics.
- Data quality warnings.
- Uncertainty or limitations.

### Example response

**Prediksi Penjualan Produk X — November 2026**

- Prediksi penjualan: 12.800 unit.
- Model yang digunakan: AutoARIMA.
- Data historis: Januari 2024 sampai September 2026.
- Backtest WAPE: 8,5%.
- Tren historis: cenderung meningkat.

"Model memperkirakan penjualan Produk X pada November 2026 sebanyak 12.800 unit berdasarkan pola historis. Hasil ini merupakan estimasi statistik dan belum memperhitungkan tren pasar eksternal."

The above response is illustrative only.

### Important

Do not claim a forecast interval, confidence level, market influence, or expected percentage increase unless supported by actual calculations.

---

# 11. Phase 8 — API Integration

If the existing architecture requires a Next.js API route, integrate forecasting through its established authenticated API pattern.

Suggested endpoint, only if appropriate:

`POST /api/forecast/sales`

Do not add an unnecessary public endpoint if existing server-side agent tools can directly invoke the forecasting service.

API requirements:

- Authentication.
- Authorization.
- Input validation with Zod.
- Safe error handling.
- Execution time limits.
- No exposure of database credentials.
- No sensitive query details in HTTP errors.
- Appropriate request logging.

The forecasting engine must run server-side, never in the browser.

---

# 12. Phase 9 — Testing

Create tests using the repository's existing testing conventions.

Do not rely exclusively on manual conversational testing.

## Required test scenarios

### Data tests

- Valid product with complete historical data.
- Product that does not exist.
- Product without sufficient data.
- Missing sales periods.
- Zero-sales periods.
- Canceled transactions.
- Refunded transactions.
- Invalid quantity values.
- Duplicate transaction records.
- Current month with incomplete data.

### Forecasting tests

- Predict next month.
- Predict next three months.
- Predict next twelve months.
- Compare against naive baseline.
- Evaluate seasonal patterns.
- Handle stable sales data.
- Handle increasing sales.
- Handle decreasing sales.
- Handle intermittent sales.
- Reject unsupported forecast horizon.
- Handle ARIMA training failure.
- Prevent negative final sales predictions.
- Ensure deterministic results when practical.

### Security tests

- Unauthorized product request.
- Unauthorized database source.
- Cross-user or cross-scope data access.
- SQL injection attempts.
- Database connection failure.
- Sensitive data leakage in tool output.

### Integration tests

- Forecast service returns valid JSON.
- VoltAgent calls the correct tool.
- Agent uses actual calculated predictions.
- Agent does not invent forecast values.
- Existing AI Agent tools continue to work.
- Existing web and WhatsApp flows remain functional.

Use synthetic fixtures for automated tests.

Avoid including real company transaction records in test snapshots.

---

# 13. Suggested Directory Structure

Adapt this structure to the actual repository.

Do not duplicate existing modules or utilities.

```text
ai-agent-mustikaratu/
|
├── lib/
│   └── forecasting/
│       ├── types.ts
│       ├── sales-repository.ts
│       ├── preprocessing.ts
│       ├── baseline-model.ts
│       ├── arima-model.ts
│       ├── backtesting.ts
│       ├── evaluation.ts
│       ├── forecasting-service.ts
│       └── forecast-tool.ts
│
├── voltagent/
│   └── ... existing agent registration
│
├── scripts/
│   └── ... forecasting tests/scripts
│
├── docs/
│   └── forecasting/
│       ├── database-mapping.md
│       ├── architecture.md
│       ├── model-evaluation.md
│       └── usage.md
│
└── ...
```

The exact file locations must follow existing project conventions.

---

# 14. Performance and Reliability Requirements

Forecasting must not compromise the performance of the existing AI Agent.

Requirements:

- Avoid unbounded database queries.
- Limit forecast horizon.
- Limit historical data extraction where appropriate.
- Avoid repeated expensive fitting for identical requests when cached results are valid.
- Use safe caching keyed by authorized scope, product, forecast cutoff, and model version.
- Ensure cached results cannot leak across users or authorization scopes.
- Invalidate or refresh forecasts when relevant source data changes.
- Handle concurrent requests safely.
- Avoid blocking the main Node.js event loop with expensive computations.
- Do not add unnecessary external infrastructure.

For the MVP, on-demand fitting is acceptable only when execution time and resource consumption are measured and acceptable.

If execution becomes expensive, propose scheduled forecasting jobs or worker threads without requiring Python.

---

# 15. Definition of Done

This phase is considered complete only when:

- [ ] Existing repository architecture has been reviewed.
- [ ] PostgreSQL sales schema has been mapped.
- [ ] Historical sales can be retrieved through authorized read-only access.
- [ ] Monthly sales aggregation is correct.
- [ ] Data quality validation works.
- [ ] Naive and seasonal baselines are implemented.
- [ ] AutoARIMA has been integrated successfully.
- [ ] Forecasting can generate predictions for supported horizons.
- [ ] Time-based backtesting is implemented.
- [ ] Model selection uses real evaluation results.
- [ ] Forecasting service returns structured JSON.
- [ ] `forecast_sales` is registered with VoltAgent.
- [ ] Agent can answer forecasting questions using tool results.
- [ ] Authorization and data isolation tests pass.
- [ ] TypeScript type checking passes.
- [ ] Project build passes.
- [ ] Existing functionality remains operational.
- [ ] Technical documentation and test results are available.

Do not mark a requirement as complete unless it has actually been verified.

---

# 16. Out of Scope

Do not implement the following in this phase:

- Tavily API.
- Brave Search API.
- Google Trends.
- Marketplace scraping.
- External news retrieval.
- Market sentiment analysis.
- Competitor monitoring.
- Forecast adjustment using LLM-generated assumptions.
- Python forecasting microservices.
- Full forecasting dashboard.
- Automated inventory purchasing.

These capabilities belong to future phases after the internal forecasting engine is validated.

---

# 17. Execution Instructions for Claude Code

Follow this workflow:

## Step 1 — Analyze

Read the repository, especially:

- `CLAUDE.md`
- `AGENTS.md`
- `package.json`
- Existing PostgreSQL modules
- Database access utilities
- Existing VoltAgent tools
- Agent registration and routing
- Existing authentication and authorization
- Existing test scripts

Describe the implementation approach based on the actual codebase.

Do not assume sample filenames or database schemas already exist.

## Step 2 — Implement

Implement the forecasting feature incrementally:

1. Data repository.
2. Preprocessing.
3. Forecasting models.
4. Backtesting and evaluation.
5. Forecasting service.
6. VoltAgent tool.
7. Tests.
8. Documentation.

Integrate with the existing application wherever possible.

Do not build an unrelated standalone demonstration.

## Step 3 — Validate

Run applicable tests, type checks, and build commands.

Where possible, verify against an authorized PostgreSQL source.

If database access is unavailable, use synthetic test fixtures and explicitly distinguish simulated validation from real database testing.

Report model comparison results with measured metrics.

## Step 4 — Final Report

After implementation, provide:

1. Summary of changes.
2. Files created.
3. Files modified.
4. Dependencies added.
5. Database schema mapping used.
6. Forecast models implemented.
7. Backtesting results.
8. VoltAgent integration details.
9. Test and build results.
10. Example user questions.
11. Known limitations and unresolved blockers.

Do not claim tests passed unless they were executed.

---

# 18. Next Development Phase

After the internal forecasting system is implemented, tested, and validated, we will create a separate implementation plan for:

**PHASE 2 — MARKET TREND INTELLIGENCE**

Planned future capabilities:

- Search current beauty and skincare trends.
- Retrieve market news and relevant industry insights.
- Analyze external demand signals.
- Compare internal sales trends with external market indicators.
- Evaluate whether external signals improve historical forecast accuracy.
- Generate business recommendations supported by internal data and external evidence.

Do not implement Phase 2 until Phase 1 is explicitly approved.

---

# Expected Final Result

A functioning Sales Forecasting Engine that integrates into the existing Mustika Ratu AI Agent system.

Example:

User:
"Prediksi penjualan produk X untuk bulan depan."

Expected system behavior:

1. VoltAgent identifies the forecasting intent.
2. Agent resolves the requested product.
3. Agent invokes `forecast_sales`.
4. The tool retrieves authorized historical sales from PostgreSQL.
5. The forecasting engine validates the time series.
6. The engine selects and runs an evaluated forecasting model.
7. The system returns a structured forecast.
8. VoltAgent explains the prediction and its limitations to the user.

All calculations must originate from historical data and statistical forecasting code, not from the language model's own estimates.

**Priority:** Correctness, security, data quality, maintainability, and compatibility with the existing architecture.