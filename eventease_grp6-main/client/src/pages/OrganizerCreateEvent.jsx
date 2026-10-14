import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useLang } from '../i18n/LanguageContext.jsx';

const EMPTY_CAT = { name: '', tier: 'standard', price: '', qty: '', earlyBirdPrice: '' };
const EMPTY_SECTION = { name: '', tier: 'standard', price: '', rows: 4, cols: 16, startingRow: 'A' };

export default function OrganizerCreateEvent() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { t } = useLang();
  const isEdit = !!id;
  const [loading, setLoading] = useState(isEdit);
  const [form, setForm] = useState({
    title: '', description: '', category: 'concert', image: '',
    venueName: '', venueAddress: '', city: 'Singapore',
    startDate: '', time: '19:00', endDate: '',
    reservedSeating: false,
    wheelchair: false, hearingLoop: false, sensory: false,
    promoEnabled: false, promoMessage: '',
    earlyBird: false, earlyBirdEnd: '',
  });
  const [cats, setCats] = useState([{ ...EMPTY_CAT }]);
  const [sections, setSections] = useState([{ ...EMPTY_SECTION }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setTick = (k) => (e) => setForm({ ...form, [k]: e.target.checked });

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/api/events/manage/${id}`)
      .then(({ data }) => {
        const e = data.event;
        const d = new Date(e.startDate);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const endDate = e.endDate && e.endDate !== e.startDate ? new Date(e.endDate) : null;
        setForm({
          title: e.title || '', description: e.description || '', category: e.category || 'concert', image: e.image || '',
          venueName: e.venue?.name || '', venueAddress: e.venue?.address || '', city: e.venue?.city || 'Singapore',
          startDate: dateStr, time: timeStr, endDate: endDate ? `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}` : '',
          reservedSeating: !!e.reservedSeating,
          wheelchair: !!e.accessibility?.wheelchair, hearingLoop: !!e.accessibility?.hearingLoop, sensory: !!e.accessibility?.sensory,
          promoEnabled: !!e.promo?.enabled, promoMessage: e.promo?.message || '',
          earlyBird: !!(e.ticketCategories || []).some((c) => c.earlyBirdPrice),
          earlyBirdEnd: (e.ticketCategories || []).find((c) => c.earlyBirdEnd)?.earlyBirdEnd
            ? new Date((e.ticketCategories || []).find((c) => c.earlyBirdEnd).earlyBirdEnd).toISOString().slice(0, 10) : '',
        });
        setCats((e.ticketCategories || []).map((c) => ({ id: c.id, name: c.name, tier: c.tier, price: c.price, qty: c.qty, earlyBirdPrice: c.earlyBirdPrice || '' })));
        setSections((e.sections || [{ ...EMPTY_SECTION }]).map((s) => ({
          name: s.name, tier: s.tier, price: s.price !== undefined ? s.price : s.price, rows: s.rows, cols: s.cols, startingRow: s.startingRow,
        })));
        setLoading(false);
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [id, isEdit]);

  const isValidCategory = (c) => c.name && c.price !== '' && c.qty !== '';
  const isValidSection = (s) => s.name && s.price !== '' && Number(s.rows) > 0 && Number(s.cols) > 0;
  const sectionError = () => {
    if (!form.reservedSeating) return '';
    const bad = sections.findIndex((s) => !s.name || s.price === '' || s.price === 0 || Number(s.rows) < 1 || Number(s.cols) < 1);
    if (bad < 0) return '';
    const s = sections[bad];
    const missing = [];
    if (!s.name) missing.push('name');
    if (s.price === '' || s.price === 0) missing.push('price');
    if (Number(s.rows) < 1) missing.push('rows');
    if (Number(s.cols) < 1) missing.push('columns');
    return t('organizerForm.errorSection', { n: bad + 1, missing: missing.join(', ') });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isValidCategory(cats[0])) return setError(t('organizerForm.errorCategory'));
    if (form.reservedSeating) {
      const se = sectionError();
      if (se) return setError(se);
    }

    const ticketCategories = cats
      .filter(isValidCategory)
      .map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        name: c.name, tier: c.tier, price: Number(c.price), qty: Number(c.qty),
        ...(form.earlyBird && c.earlyBirdPrice !== '' && c.earlyBirdPrice != null
          ? { earlyBirdPrice: Number(c.earlyBirdPrice), earlyBirdEnd: form.earlyBirdEnd ? new Date(form.earlyBirdEnd) : undefined }
          : {}),
      }));

    const payload = {
      title: form.title,
      description: form.description,
      category: form.category,
      image: form.image,
      venue: { name: form.venueName, address: form.venueAddress, city: form.city },
      startDate: new Date(`${form.startDate}T${form.time}`),
      endDate: form.endDate ? new Date(`${form.endDate}T${form.time}`) : undefined,
      ticketCategories,
      reservedSeating: form.reservedSeating,
      accessibility: { wheelchair: form.wheelchair, hearingLoop: form.hearingLoop, sensory: form.sensory },
      promo: form.promoEnabled ? { enabled: true, message: form.promoMessage } : { enabled: false },
    };
    if (form.reservedSeating) {
      payload.sections = sections
        .filter(isValidSection)
        .map((s, idx) => ({ ...s, categoryId: `NEW_SECTION_${idx}`, price: Number(s.price), rows: Number(s.rows), cols: Number(s.cols), name: s.name, tier: s.tier, startingRow: s.startingRow }));
    }

    setBusy(true);
    try {
      if (isEdit) {
        await api.patch(`/api/events/manage/${id}`, payload);
        navigate(`/organizer?updated=${id}`);
      } else {
        const { data } = await api.post('/api/events', payload);
        navigate(`/organizer?created=${data.event.id}`);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (loading) return <div className="container center" style={{ padding: '4rem 0' }}>{t('organizerForm.loading')}</div>;

  return (
    <div className="container narrow">
      <div className="card">
        <h1>{isEdit ? t('organizerForm.editEvent') : t('organizerForm.createEvent')}</h1>
        <p className="muted">{t('organizerForm.intro')}</p>

        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={submit}>
          <h3>{t('organizerForm.details')}</h3>
          <label>{t('organizerForm.title')}
            <input required value={form.title} onChange={set('title')} placeholder={t('organizerForm.titlePlaceholder')} />
          </label>
          <label>{t('organizerForm.description')}
            <textarea rows="3" value={form.description} onChange={set('description')} placeholder={t('organizerForm.descriptionPlaceholder')} />
          </label>
          <div className="grid2">
            <label>{t('organizerForm.category')}
              <select value={form.category} onChange={set('category')}>
                <option value="concert">{t('eventCard.category.concert')}</option>
                <option value="theatre">{t('eventCard.category.theatre')}</option>
                <option value="sports">{t('eventCard.category.sports')}</option>
                <option value="cultural">{t('eventCard.category.cultural')}</option>
                <option value="festival">{t('eventCard.category.festival')}</option>
                <option value="other">{t('eventCard.category.other')}</option>
              </select>
            </label>
            <label>{t('organizerForm.imageUrl')}
              <input type="url" value={form.image} onChange={set('image')} placeholder="https://…" />
            </label>
          </div>

          <h3>{t('organizerForm.venueTime')}</h3>
          <label>{t('organizerForm.venueName')}
            <input required value={form.venueName} onChange={set('venueName')} />
          </label>
          <label>{t('organizerForm.address')}
            <input value={form.venueAddress} onChange={set('venueAddress')} />
          </label>
          <div className="grid2">
            <label>{t('organizerForm.city')}
              <input required value={form.city} onChange={set('city')} />
            </label>
            <label>{t('organizerForm.startDateTime')}
              <span className="datepair">
                <input type="date" required value={form.startDate} onChange={set('startDate')} />
                <input type="time" value={form.time} onChange={set('time')} />
              </span>
            </label>
          </div>
          <div className="grid2">
            <label>{t('organizerForm.endDate')} <span className="muted small">{t('organizerForm.multiDayNote')}</span>
              <input type="date" value={form.endDate} min={form.startDate || undefined} onChange={set('endDate')} />
            </label>
          </div>

          <h3>{t('organizerForm.ticketCategories')}</h3>
          {cats.map((c, i) => (
            <div className="cat-editor" key={i}>
              <input placeholder={c.tier === 'vip' ? 'VIP' : c.tier === 'concession' ? 'Concession' : 'Standard'} value={c.name}
                onChange={(e) => { const x = [...cats]; x[i].name = e.target.value; setCats(x); }} />
              <select value={c.tier} onChange={(e) => { const x = [...cats]; x[i].tier = e.target.value; setCats(x); }}>
                <option value="vip">VIP</option><option value="standard">Standard</option><option value="concession">Concession</option>
              </select>
              <input type="number" min="0" step="1" placeholder={t('organizerForm.qty')} value={c.qty}
                onChange={(e) => { const x = [...cats]; x[i].qty = e.target.value; setCats(x); }} />
              <input type="number" min="0" step="0.5" placeholder={t('organizerForm.price')} value={c.price}
                onChange={(e) => { const x = [...cats]; x[i].price = e.target.value; setCats(x); }} />
              {form.earlyBird && (
                <input type="number" min="0" step="0.5" placeholder={t('organizerForm.earlyBird')} value={c.earlyBirdPrice}
                  onChange={(e) => { const x = [...cats]; x[i].earlyBirdPrice = e.target.value; setCats(x); }} />
              )}
              {cats.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCats(cats.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCats([...cats, { ...EMPTY_CAT }])}>{t('organizerForm.addCategory')}</button>

          <label className="switch-row">
            <input type="checkbox" checked={form.earlyBird} onChange={setTick('earlyBird')} />
            <span>{t('organizerForm.enableEarlyBird')}</span>
          </label>
          {form.earlyBird && (
            <div className="grid2">
              <label>{t('organizerForm.earlyBirdEnds')}
                <input type="date" value={form.earlyBirdEnd} onChange={set('earlyBirdEnd')} />
              </label>
              <p className="muted small" style={{ alignSelf: 'end', margin: '0 0 0.6rem' }}>
                {t('organizerForm.earlyBirdNote')}
              </p>
            </div>
          )}

          {form.reservedSeating && (
            <>
              <h3>{t('organizerForm.seatingLayout')}</h3>
              {sections.map((s, i) => (
                <div className="cat-editor" key={i}>
                  <input placeholder={t('organizerForm.sectionName')} value={s.name} onChange={(e) => { const x = [...sections]; x[i].name = e.target.value; setSections(x); }} />
                  <select value={s.tier} onChange={(e) => { const x = [...sections]; x[i].tier = e.target.value; setSections(x); }}>
                    <option value="vip">VIP</option><option value="standard">Standard</option><option value="concession">Concession</option>
                  </select>
                  <input type="number" min="0" step="0.5" placeholder={t('organizerForm.price')} value={s.price}
                    onChange={(e) => { const x = [...sections]; x[i].price = e.target.value; setSections(x); }} />
                  <input type="number" min="1" placeholder={t('organizerForm.rows')} value={s.rows} onChange={(e) => { const x = [...sections]; x[i].rows = e.target.value; setSections(x); }} />
                  <input type="number" min="1" placeholder={t('organizerForm.seatsPerRow')} value={s.cols} onChange={(e) => { const x = [...sections]; x[i].cols = e.target.value; setSections(x); }} />
                  <input value={s.startingRow} maxLength={1} placeholder="A" onChange={(e) => { const x = [...sections]; x[i].startingRow = e.target.value.toUpperCase(); setSections(x); }} />
                  {sections.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSections(sections.filter((_, j) => j !== i))}>✕</button>}
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSections([...sections, { ...EMPTY_SECTION }])}>{t('organizerForm.addSection')}</button>
            </>
          )}
          <label className="switch-row">
            <input type="checkbox" checked={form.reservedSeating} onChange={setTick('reservedSeating')} />
            <span>{t('organizerForm.reservedSeating')}</span>
          </label>

          <h3>{t('organizerForm.accessibility')}</h3>
          <div className="check-row">
            <label className="switch-row"><input type="checkbox" checked={form.wheelchair} onChange={setTick('wheelchair')} /><span>♿ {t('eventPage.wheelchairAccess')}</span></label>
            <label className="switch-row"><input type="checkbox" checked={form.hearingLoop} onChange={setTick('hearingLoop')} /><span>🦻 {t('eventPage.hearingLoop')}</span></label>
            <label className="switch-row"><input type="checkbox" checked={form.sensory} onChange={setTick('sensory')} /><span>🧘 {t('eventPage.sensoryFriendly')}</span></label>
          </div>

          <h3>{t('organizerForm.promo')}</h3>
          <label className="switch-row"><input type="checkbox" checked={form.promoEnabled} onChange={setTick('promoEnabled')} /><span>{t('organizerForm.showPromo')}</span></label>
          {form.promoEnabled && (
            <label>{t('organizerForm.bannerText')}
              <input value={form.promoMessage} onChange={set('promoMessage')} placeholder={t('organizerForm.bannerPlaceholder')} />
            </label>
          )}

          <button className="btn btn-dark full" disabled={busy}>{busy ? t('organizerForm.saving') : isEdit ? t('organizerForm.saveChanges') : t('organizerForm.createSubmit')}</button>
          <p className="muted small">{t('organizerForm.reviewNote')}</p>
        </form>
      </div>
    </div>
  );
}