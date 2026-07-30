import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, CalendarDays, Eye, Users } from 'lucide-react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { analyticsEnabled, fetchAnalyticsSummary, fetchSearchStats, recordVisit, supabase } from '../lib/supabase';

const PANEL_HEIGHT = 340;

export default function SearchInsights({ isEnglish, onSelect }) {
  const panelRef = useRef(null);
  const [width, setWidth] = useState(900);
  const [onlineCount, setOnlineCount] = useState(0);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total_visits: 0, total_searches: 0, today_searches: 0 });

  useEffect(() => {
    if (!panelRef.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!analyticsEnabled) return undefined;
    let active = true;
    const refresh = () => Promise.all([fetchSearchStats(30), fetchAnalyticsSummary()])
      .then(([data, totals]) => {
        if (!active) return;
        setItems(data);
        setSummary(totals);
      })
      .catch(() => {});
    if (!sessionStorage.getItem('flavor-visit-recorded')) {
      sessionStorage.setItem('flavor-visit-recorded', 'pending');
      recordVisit()
        .then(recorded => {
          if (!recorded) return;
          sessionStorage.setItem('flavor-visit-recorded', '1');
          refresh();
        })
        .catch(() => sessionStorage.removeItem('flavor-visit-recorded'));
    }
    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('flavor-search-recorded', refresh);

    const presenceKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const channel = supabase.channel('flavor-threshold-online', { config: { presence: { key: presenceKey } } });
    channel
      .on('presence', { event: 'sync' }, () => {
        const count = Object.values(channel.presenceState()).reduce((sum, presences) => sum + presences.length, 0);
        if (active) setOnlineCount(count);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() });
      });

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('flavor-search-recorded', refresh);
      supabase.removeChannel(channel);
    };
  }, []);

  const leaves = useMemo(() => {
    if (!items.length) return [];
    const root = hierarchy({ children: items })
      .sum(item => Number(item.search_count || 0))
      .sort((a, b) => b.value - a.value);
    treemap().size([width, PANEL_HEIGHT]).paddingInner(3).round(true).tile(treemapSquarify.ratio(1.2))(root);
    return root.leaves();
  }, [items, width]);

  const maxCount = Math.max(1, ...items.map(item => Number(item.search_count || 0)));

  return (
    <section className="search-insights" aria-labelledby="search-insights-title">
      <div className="search-insights-heading">
        <div>
          <span className="search-insights-kicker"><Activity size={15} /> {isEnglish ? 'Live database activity' : '数据库实时动态'}</span>
          <h2 id="search-insights-title">{isEnglish ? 'Most searched compounds' : '热门检索化合物'}</h2>
          <p>{isEnglish ? 'Tile area represents verified searches. Select a compound to view its records.' : '矩形面积代表有效检索次数，点击化合物可直接查看记录。'}</p>
        </div>
        <div className="search-insights-counters">
          <span><Eye size={16} /><strong>{summary.total_visits}</strong>{isEnglish ? 'visits' : '累计访问'}</span>
          <span><Users size={16} /><strong>{onlineCount}</strong>{isEnglish ? 'online' : '人在线'}</span>
          <span><BarChart3 size={16} /><strong>{summary.total_searches}</strong>{isEnglish ? 'searches' : '累计检索'}</span>
          <span><CalendarDays size={16} /><strong>{summary.today_searches}</strong>{isEnglish ? 'today' : '今日检索'}</span>
        </div>
      </div>

      <div ref={panelRef} className="compound-treemap" aria-live="polite">
        {!analyticsEnabled && <p className="treemap-empty">{isEnglish ? 'Analytics is not configured.' : '统计服务尚未配置。'}</p>}
        {analyticsEnabled && !leaves.length && <p className="treemap-empty">{isEnglish ? 'Search activity will appear here after the first query.' : '首次检索后，热门化合物将在这里显示。'}</p>}
        {leaves.map(leaf => {
          const item = leaf.data;
          const tileWidth = leaf.x1 - leaf.x0;
          const tileHeight = leaf.y1 - leaf.y0;
          const strength = Number(item.search_count || 0) / maxCount;
          return (
            <button
              type="button"
              key={item.cas}
              className="compound-tile"
              style={{ left: leaf.x0, top: leaf.y0, width: tileWidth, height: tileHeight, '--tile-strength': strength }}
              title={`${item.common_name} · CAS ${item.cas}${item.chinese_name ? ` · ${item.chinese_name}` : ''} · ${item.search_count} ${isEnglish ? 'searches' : '次检索'}`}
              onClick={() => onSelect(item)}
            >
              {tileWidth > 72 && tileHeight > 42 && <strong>{item.common_name}</strong>}
              {tileWidth > 150 && tileHeight > 70 && <span>CAS {item.cas}</span>}
              {tileWidth > 110 && tileHeight > 96 && <small>{item.search_count} {isEnglish ? 'searches' : '次检索'}</small>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
