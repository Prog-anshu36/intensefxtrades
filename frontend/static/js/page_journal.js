/* page_journal.js - Trade Journal page */

const PageJournal = {
  selectedMood: "neutral",
  MOODS: { confident: "Confident", neutral: "Neutral", anxious: "Anxious", frustrated: "Frustrated", proud: "Proud" },

  render() {
    const entries = Store.state.journal || [];
    const snap = typeof TradeAnalyticsEngine !== "undefined" ? TradeAnalyticsEngine.snapshot(Store.state) : null;
    return `
      <div class="section-title" style="font-size:19px;margin-bottom:2px">Trade Journal</div>
      <div class="section-sub" style="margin-bottom:18px">Reflect on your trades to build discipline and spot patterns</div>

      ${snap ? `<div class="grid grid-4" style="margin-bottom:16px">
        ${this.miniKpi("Journaled Trades", `${snap.trades.filter((t) => t.journalEntries.length).length}/${snap.trades.length}`)}
        ${this.miniKpi("Avg Confidence", `${(snap.trades.length ? snap.trades.reduce((s, t) => s + (t.confidence || 0), 0) / snap.trades.length : 0).toFixed(1)}/10`)}
        ${this.miniKpi("Top Emotion", `${snap.emotions[0]?.name || "--"}`)}
        ${this.miniKpi("Checklist Edge", this.checklistEdge(snap.trades))}
      </div>` : ""}

      <div class="journal-layout">
        <div>
          ${entries.length === 0
            ? `<div class="card">${emptyState("No journal entries yet", "Write your first reflection using the form on the right.", null, { label: "Start writing", onClick: () => document.getElementById("jTitle")?.focus() })}</div>`
            : entries.map((e) => this.entryCard(e)).join("")}
        </div>

        <div class="card journal-form journal-compose-card">
          <div class="journal-compose-head">
            <div>
              <div class="section-title" style="margin-bottom:2px">New Entry</div>
              <div class="section-sub" style="margin-bottom:6px">Link it to a trade or write freely</div>
            </div>
            <span class="journal-compose-badge">Review</span>
          </div>

          <label>Title</label>
          <input type="text" id="jTitle" placeholder="e.g. Revenge trade on EURUSD">

          <label>Related trade (optional)</label>
          <select id="jTrade">
            <option value="">Freeform entry</option>
            ${Store.state.history.slice().reverse().map((t) => `<option value="${t.id}">#${t.id} - ${t.symbol} ${t.type} - ${Fmt.money(t.pnl)}</option>`).join("")}
          </select>

          <label>Emotion</label>
          <div class="mood-picker" id="moodPicker">
            ${Object.entries(this.MOODS).map(([key, label]) => `<button type="button" class="mood-opt ${key === this.selectedMood ? "selected" : ""}" data-mood="${key}" title="${label}">${label}</button>`).join("")}
          </div>

          <div class="grid grid-2" style="gap:10px">
            <div>
              <label>Strategy</label>
              <input type="text" id="jStrategy" placeholder="ICT, SMC, Breakout">
            </div>
            <div>
              <label>Session</label>
              <select id="jSession">
                ${["Auto", "Sydney", "Tokyo", "London", "New York", "Overlap"].map((s) => `<option value="${s}">${s}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="grid grid-2" style="gap:10px">
            <div>
              <label>Risk : Reward</label>
              <input type="text" id="jRiskReward" placeholder="e.g. 1:2">
            </div>
            <div>
              <label>Market condition</label>
              <select id="jMarketCondition"><option value="">Select</option><option>Trending</option><option>Ranging</option><option>Volatile</option><option>News</option><option>Choppy</option></select>
            </div>
          </div>

          <div class="grid grid-2" style="gap:10px">
            <div>
              <label>Confidence</label>
              <input type="number" id="jConfidence" min="0" max="10" step="1" placeholder="0-10">
            </div>
            <div>
              <label>Execution Rating</label>
              <input type="number" id="jExecutionRating" min="0" max="10" step="1" placeholder="0-10">
            </div>
          </div>

          <label>Checklist</label>
          <div class="journal-checklist">
            ${TradeAnalyticsEngine.checklistDefaults.map((item) => `<label class="journal-check"><input type="checkbox" data-check-item="${this.escape(item)}"> <span>${this.escape(item)}</span></label>`).join("")}
          </div>

          <label>Notes</label>
          <textarea id="jNote" placeholder="What was your reasoning? What would you do differently next time?"></textarea>

          <label>Lesson Learned</label>
          <textarea id="jLesson" placeholder="What lesson should this trade teach?"></textarea>

          <label>Mistake</label>
          <input type="text" id="jMistake" placeholder="e.g. FOMO, late entry, ignored stop">

          <label>Tags (comma separated)</label>
          <input type="text" id="jTags" placeholder="e.g. discipline, fomo, plan-followed">

          <label>Screenshots / Attachments</label>
          <textarea id="jScreenshots" placeholder="Paste image paths or links, one per line"></textarea>

          <button class="btn btn-primary journal-save-btn" id="jSubmit">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 21v-8h10v8M7 3v5h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            <span>Save Entry</span>
          </button>
        </div>
      </div>
    `;
  },

  entryCard(e) {
    const date = new Date(e.created_at);
    return `
      <div class="journal-entry">
        <div class="journal-entry-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="mood-emoji">${this.escape(this.MOODS[e.mood] || e.mood || "Note")}</span>
            <span class="journal-entry-title">${this.escape(e.title)}</span>
            ${e.trade_id ? `<span class="kpi-pill">Trade #${e.trade_id}</span>` : ""}
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="journal-entry-date">${Fmt.dateTime(date)}</span>
            <button class="journal-delete" data-delete-id="${e.id}" title="Delete entry">Delete</button>
          </div>
        </div>
        <div class="journal-entry-note">${this.escape(e.note)}</div>
        ${(e.lesson || e.mistake || e.strategy || e.session || e.confidence || e.execution_rating || e.risk_reward || e.market_condition) ? `<div class="journal-meta-grid">
          ${e.strategy ? `<span>Strategy <b>${this.escape(e.strategy)}</b></span>` : ""}
          ${e.session ? `<span>Session <b>${this.escape(e.session)}</b></span>` : ""}
          ${e.confidence ? `<span>Confidence <b>${e.confidence}/10</b></span>` : ""}
          ${e.execution_rating ? `<span>Execution <b>${e.execution_rating}/10</b></span>` : ""}
          ${e.risk_reward ? `<span>R:R <b>${this.escape(e.risk_reward)}</b></span>` : ""}
          ${e.market_condition ? `<span>Market <b>${this.escape(e.market_condition)}</b></span>` : ""}
          ${e.mistake ? `<span>Mistake <b>${this.escape(e.mistake)}</b></span>` : ""}
          ${e.lesson ? `<span>Lesson <b>${this.escape(e.lesson)}</b></span>` : ""}
        </div>` : ""}
        ${e.checklist ? `<div class="journal-tags">${Object.entries(e.checklist).filter(([, v]) => v).map(([k]) => `<span class="journal-tag">OK ${this.escape(k)}</span>`).join("")}</div>` : ""}
        ${e.screenshots?.length ? `<div class="journal-tags">${e.screenshots.map((s) => `<span class="journal-tag">Attachment: ${this.escape(s)}</span>`).join("")}</div>` : ""}
        ${e.tags && e.tags.length ? `<div class="journal-tags">${e.tags.map((t) => `<span class="journal-tag">#${this.escape(t)}</span>`).join("")}</div>` : ""}
      </div>
    `;
  },

  miniKpi(label, value) {
    return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div></div>`;
  },

  checklistEdge(trades) {
    const followed = trades.filter((t) => Object.values(t.checklist || {}).filter(Boolean).length >= 6);
    const ignored = trades.filter((t) => Object.values(t.checklist || {}).filter(Boolean).length < 6);
    const fp = followed.length ? followed.reduce((s, t) => s + t.pnl, 0) / followed.length : 0;
    const ip = ignored.length ? ignored.reduce((s, t) => s + t.pnl, 0) / ignored.length : 0;
    return `${fp - ip >= 0 ? "+" : ""}${(fp - ip).toFixed(2)}`;
  },

  escape(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  },

  afterRender(container) {
    container.querySelectorAll("[data-mood]").forEach((el) => {
      el.addEventListener("click", () => {
        this.selectedMood = el.dataset.mood;
        container.querySelectorAll("[data-mood]").forEach((m) => m.classList.toggle("selected", m.dataset.mood === this.selectedMood));
      });
    });

    container.querySelectorAll("[data-delete-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await API.deleteJournal(parseInt(btn.dataset.deleteId, 10));
        await Store.refresh();
        this.rerender(container);
        toast("Journal entry deleted", "info");
      });
    });

    container.querySelector("#jSubmit")?.addEventListener("click", async () => {
      const title = container.querySelector("#jTitle").value.trim();
      const note = container.querySelector("#jNote").value.trim();
      const tradeId = container.querySelector("#jTrade").value;
      const tagsRaw = container.querySelector("#jTags").value.trim();
      const checklist = {};
      container.querySelectorAll("[data-check-item]").forEach((el) => { checklist[el.dataset.checkItem] = el.checked; });

      if (!title || !note) {
        toast("Add a title and some notes first", "error");
        return;
      }

      await API.addJournal({
        title,
        note,
        mood: this.selectedMood,
        emotion: this.selectedMood,
        tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
        trade_id: tradeId ? parseInt(tradeId, 10) : null,
        strategy: container.querySelector("#jStrategy").value.trim(),
        session: container.querySelector("#jSession").value === "Auto" ? "" : container.querySelector("#jSession").value,
        confidence: parseInt(container.querySelector("#jConfidence").value || "0", 10),
        execution_rating: parseInt(container.querySelector("#jExecutionRating").value || "0", 10),
        trade_rating: parseInt(container.querySelector("#jExecutionRating").value || "0", 10),
        lesson: container.querySelector("#jLesson").value.trim(),
        mistake: container.querySelector("#jMistake").value.trim(),
        risk_reward: container.querySelector("#jRiskReward").value.trim(),
        market_condition: container.querySelector("#jMarketCondition").value,
        checklist,
        screenshots: container.querySelector("#jScreenshots").value.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      await Store.refresh();
      this.selectedMood = "neutral";
      this.rerender(container);
      toast("Journal entry saved", "success");
    });
  },

  rerender(container) {
    container.innerHTML = this.render();
    this.afterRender(container);
  },
};
