# Handling Long Journals: Design Options

When a journal exceeds the context window, we currently truncate the oldest entries. This document explores better approaches.

## Current Approach

Truncate oldest entries until the journal fits. Simple but loses potentially valuable context.

## Alternative Approaches

### 1. Hierarchical Summarization

Process the journal in time-based tiers:
- **Recent (e.g., last 2 weeks)**: Include full entries
- **Medium-term (e.g., last 3 months)**: Summarize into weekly digests
- **Older**: Summarize into monthly or quarterly digests

**Pros**: Preserves long-term context while prioritizing recency
**Cons**: Requires multiple API calls; summaries may lose nuance

### 2. Two-Pass Analysis

1. **First pass**: Scan entire journal to extract key themes, recurring topics, significant events, and open threads
2. **Second pass**: Detailed analysis using recent entries + first-pass summary

**Pros**: Nothing is truly "lost"; themes from old entries persist
**Cons**: Doubles API cost; first pass might miss context needed for second

### 3. Embedding-Based Relevance Selection

Use embeddings to select entries most relevant to:
- Custom topics the user specified
- Themes detected in recent entries
- A mix of recency + semantic relevance

**Pros**: Intelligently selects what matters; custom topics get relevant historical context
**Cons**: Requires embedding infrastructure; adds latency; may miss important but semantically distant entries

### 4. Rolling Summary Persistence

Maintain a persistent "journal summary" that evolves over time:
- Each report generation updates the summary with new developments
- Summary captures ongoing themes, goals, relationships, and unresolved threads
- Include summary + recent entries in each report

**Pros**: True continuity across reports; no context ever fully lost
**Cons**: Summary drift over time; requires storage; first-time users have no summary

### 5. User-Guided Selection

Let users control what's included:
- Mark entries as "important" or "reference"
- Select date ranges to focus on
- Exclude certain periods

**Pros**: User knows what matters; no wasted context on irrelevant entries
**Cons**: Requires user effort; users may not know what's relevant for AI analysis

### 6. Chunked Processing with Synthesis

Process journal in overlapping chunks, generate partial insights, then synthesize:
1. Split journal into chunks with date overlap
2. Generate insights for each chunk
3. Final pass synthesizes chunk insights into cohesive report

**Pros**: Handles arbitrarily long journals; parallelizable
**Cons**: High API cost; synthesis may lose nuance; complex orchestration

### 7. Smart Truncation with Anchors

Enhanced truncation that preserves "anchor" entries:
- First entry (establishes baseline)
- Entries referenced by recent entries
- Entries with high emotional significance (detected via sentiment)
- Entries containing goals, commitments, or decisions

**Pros**: Simple extension of current approach; preserves key moments
**Cons**: Detection heuristics may miss important entries

### 8. Periodic Background Summarization

Summarize old entries asynchronously (not during report generation):
- When user uploads journal, summarize older portions in background
- Store summaries alongside original entries
- Report generation uses summaries for old content, full text for recent

**Pros**: No latency impact on report generation; summaries can be high quality
**Cons**: Requires background processing infrastructure; storage costs

## Recommendation

A combination of approaches likely works best:

1. **Short term**: Implement smart truncation with anchors (#7) - low effort, meaningful improvement
2. **Medium term**: Add rolling summary persistence (#4) - enables true longitudinal analysis
3. **Long term**: Consider hierarchical summarization (#1) or background summarization (#8) for users with very long journals

The rolling summary approach is particularly compelling because it aligns with the product's goal of maintaining coherence beyond what memory handles by default.

## Open Questions

- What's the actual distribution of journal lengths among users?
- How often do users have journals that exceed context?
- Would users pay for "full journal analysis" as a premium feature?
- How important is it that old entries can influence reports vs. just recent ones?
