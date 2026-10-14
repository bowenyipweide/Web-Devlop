import React, { useMemo, useState } from 'react';

const STATUS_STYLE = {
  available: 'seat-available',
  held: 'seat-held',
  booked: 'seat-booked',
  selected: 'seat-selected',
};

export default function SeatMap({ seats, onSelection, limit }) {
  const [selected, setSelected] = useState([]);

  const grouped = useMemo(() => {
    const map = new Map();
    (seats || []).forEach((s) => {
      const key = s.section;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return [...map.entries()].map(([section, list]) => ({
      section,
      rows: [...new Set(list.map((s) => s.row))].sort().map((row) => ({
        row,
        seats: list
          .filter((s) => s.row === row)
          .sort((a, b) => a.number - b.number),
      })),
    }));
  }, [seats]);

  const toggleSeat = (seat) => {
    if (seat.status === 'held' || seat.status === 'booked') return;
    if (selected.some((s) => s._id === seat._id)) {
      const next = selected.filter((s) => s._id !== seat._id);
      setSelected(next);
      if (onSelection) onSelection(next);
      return;
    }
    if (selected.length >= limit) {
      alert(`You can select up to ${limit} seats per order.`);
      return;
    }
    const next = [...selected, seat];
    setSelected(next);
    if (onSelection) onSelection(next);
  };

  return (
    <div className="seatmap">
      <div className="seatmap-stage" role="img" aria-label="Stage">STAGE</div>
      <div className="seat-legend" aria-hidden="true">
        <span><i className="seat-dot seat-available" />Available</span>
        <span><i className="seat-dot seat-selected" />Selected</span>
        <span><i className="seat-dot seat-held" />Held</span>
        <span><i className="seat-dot seat-booked" />Sold</span>
      </div>
      {grouped.map(({ section, rows }) => (
        <div className="seat-section" key={section}>
          <h4 className="seat-section-title">{section}</h4>
          {rows.map(({ row, seats: rowSeats }) => (
            <div className="seat-row" key={row}>
              <span className="seat-row-label">{row}</span>
              {rowSeats.map((s) => {
                const isSel = selected.some((x) => x._id === s._id);
                const status = isSel ? 'selected' : s.status;
                return (
                  <button
                    key={s._id}
                    className={`seat ${STATUS_STYLE[status]}`}
                    disabled={s.status === 'held' || s.status === 'booked'}
                    onClick={() => toggleSeat(s)}
                    title={`${s.section} ${s.row}${s.number} · $${s.price}`}
                    aria-label={`${s.section} row ${s.row} seat ${s.number} ${status}`}
                  >
                    {s.number}
                  </button>
                );
              })}
              <span className="seat-row-label">{row}</span>
            </div>
          ))}
        </div>
      ))}
      <p className="muted" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
        Seats are held for 10 minutes while you pay.
      </p>
    </div>
  );
}