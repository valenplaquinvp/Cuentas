/* Cuentas Claras — intérprete de frases habladas en español rioplatense.
   Convierte "gasté 5 lucas en nafta ayer" en {tipo, monto, categoría, fecha, nota}. */
(function (root) {
  'use strict';

  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ---------- números hablados ----------
  const WORDS = {
    cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
    dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22,
    veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
    veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80,
    noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
    cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
    seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
    novecientos: 900, novecientas: 900,
  };
  const TENS = new Set(['treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']);
  const MULT = {
    mil: 1e3, luca: 1e3, lucas: 1e3, k: 1e3, lukas: 1e3,
    millon: 1e6, millones: 1e6, palo: 1e6, palos: 1e6, melon: 1e6, melones: 1e6,
    gamba: 100, gambas: 100,
  };
  const CURRENCY = new Set(['pesos', 'peso', '$', 'mangos', 'morlacos', 'ars']);

  function parseNumeric(tok) {
    let s = tok.replace(/^\$/, '').replace(/\$$/, '');
    let mult = 1;
    const suf = s.match(/^([\d.,]+)(k|mil|m|lucas?)$/);
    if (suf) { s = suf[1]; mult = suf[2] === 'm' ? 1e6 : 1e3; }
    if (!/^\d[\d.,]*$/.test(s)) return null;
    s = s.replace(/[.,]$/, '');
    if (s.includes('.') && s.includes(',')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (s.includes('.')) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    }
    const v = parseFloat(s);
    return isNaN(v) ? null : v * mult;
  }

  const isNumTok = t => parseNumeric(t.n) !== null || t.n in WORDS || t.n in MULT || t.n === '$';

  // Busca tramos de tokens que forman un monto y devuelve el de mayor valor.
  function findAmount(toks) {
    const spans = [];
    let i = 0;
    while (i < toks.length) {
      if (!isNumTok(toks[i])) { i++; continue; }
      const start = i;
      let total = 0, cur = 0, lastMult = 0, hasDigitOrWord = false, prev = null;
      while (i < toks.length) {
        const t = toks[i], n = t.n;
        const num = parseNumeric(n);
        if (num !== null) {
          if (prev === 'num') break; // dos números seguidos = dos montos distintos
          cur += num; hasDigitOrWord = true; prev = 'num';
        } else if (n in WORDS) {
          if (prev === 'num') break;
          cur += WORDS[n]; hasDigitOrWord = true; prev = TENS.has(n) ? 'tens' : 'word';
        } else if (n in MULT) {
          if (!hasDigitOrWord && (n === 'k')) break;
          const m = MULT[n];
          if (cur === 0) cur = 1;
          total += cur * m; cur = 0; lastMult = m; hasDigitOrWord = true; prev = 'mult';
        } else if (n === 'y' && i + 1 < toks.length) {
          const nx = toks[i + 1].n;
          if (prev === 'tens' && nx in WORDS && WORDS[nx] < 10) { i++; continue; }
          if (prev === 'mult' && (nx === 'medio' || nx === 'media')) { total += lastMult / 2; i += 2; prev = 'end'; continue; }
          break;
        } else if (CURRENCY.has(n) || n === '$') {
          i++; continue;
        } else break;
        i++;
      }
      const value = total + cur;
      if (i === start) i++;
      // "un"/"una" solos no son montos ("un café")
      const onlyArticle = i - start === 1 && (toks[start].n === 'un' || toks[start].n === 'una');
      if (value > 0 && hasDigitOrWord && !onlyArticle) spans.push({start, end: i, value});
    }
    if (!spans.length) return null;
    return spans.reduce((a, b) => (b.value > a.value ? b : a));
  }

  // ---------- fechas ----------
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function findDate(text, today) {
    const t = norm(text);
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const shift = n => { const d = new Date(base); d.setDate(d.getDate() - n); return d; };
    let m;
    if ((m = t.match(/\b(antes de ayer|anteayer|antier)\b/))) return {date: iso(shift(2)), match: m[0]};
    if ((m = t.match(/\bayer\b/))) return {date: iso(shift(1)), match: m[0]};
    if ((m = t.match(/\bhace (\d+|un|una|dos|tres|cuatro|cinco|seis) dias?\b/))) {
      const n = /\d/.test(m[1]) ? +m[1] : WORDS[m[1]];
      return {date: iso(shift(n)), match: m[0]};
    }
    if ((m = t.match(/\b(?:el )?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)( pasado)?\b/))) {
      const target = DIAS.indexOf(m[1]);
      let diff = (base.getDay() - target + 7) % 7;
      if (m[2] && diff === 0) diff = 7;
      return {date: iso(shift(diff)), match: m[0]};
    }
    if ((m = t.match(new RegExp(`\\bel (\\d{1,2})(?: de (${MESES.join('|')}))?\\b(?!\\s*(mil|lucas?|palos?|pesos|k)\\b)`)))) {
      const day = +m[1];
      if (day >= 1 && day <= 31) {
        let month = m[2] ? MESES.indexOf(m[2]) : base.getMonth();
        let year = base.getFullYear();
        let d = new Date(year, month, day);
        if (d > base) d = m[2] ? new Date(year - 1, month, day) : new Date(year, month - 1, day);
        return {date: iso(d), match: m[0]};
      }
    }
    if ((m = t.match(/\bhoy\b/))) return {date: iso(base), match: m[0]};
    return {date: iso(base), match: null};
  }

  // ---------- categorías ----------
  const KEYWORDS = {
    super: ['super', 'supermercado', 'chino', 'coto', 'carrefour', 'dia', 'jumbo', 'disco', 'vea', 'changomas', 'verduleria', 'verdura', 'fruta', 'carniceria', 'carne', 'almacen', 'mercado', 'mercaderia', 'compras', 'fiambreria', 'panaderia', 'pan', 'polleria', 'dietetica', 'kiosco', 'maxikiosco', 'leche', 'yerba', 'autoservicio', 'mayorista', 'makro', 'diarco', 'limpieza'],
    comidas: ['comida', 'comidas', 'comer', 'restaurante', 'restaurant', 'resto', 'bar', 'cafe', 'cafecito', 'delivery', 'pedidosya', 'pedidos ya', 'rappi', 'pizza', 'pizzeria', 'hamburguesa', 'hamburguesas', 'burger', 'sushi', 'parrilla', 'asado', 'empanadas', 'helado', 'heladeria', 'almuerzo', 'cena', 'desayuno', 'merienda', 'birra', 'birras', 'cerveza', 'cervezas', 'mcdonalds', 'mc donalds', 'mostaza', 'lomito', 'milanesa', 'medialunas', 'facturas', 'sandwich', 'bodegon', 'cerveceria', 'vermu', 'tragos'],
    transporte: ['nafta', 'combustible', 'gasoil', 'gnc', 'sube', 'colectivo', 'bondi', 'tren', 'subte', 'uber', 'cabify', 'didi', 'remis', 'taxi', 'peaje', 'estacionamiento', 'cochera', 'micro', 'pasaje', 'pasajes', 'auto', 'mecanico', 'gomeria', 'service', 'patente', 'seguro del auto', 'ypf', 'shell', 'axion', 'moto', 'bici', 'lavadero'],
    alquiler: ['alquiler', 'expensas', 'luz', 'gas', 'agua', 'internet', 'wifi', 'celular', 'telefono', 'abl', 'edenor', 'edesur', 'metrogas', 'naturgy', 'aysa', 'fibertel', 'personal', 'movistar', 'claro', 'telecentro', 'servicios', 'servicio', 'cable', 'flow', 'directv', 'impuesto', 'impuestos', 'municipal', 'garrafa', 'boleta', 'factura de luz'],
    salud: ['farmacia', 'farmacity', 'remedio', 'remedios', 'medicamento', 'medicamentos', 'pastillas', 'prepaga', 'osde', 'swiss medical', 'galeno', 'omint', 'medife', 'medico', 'medica', 'doctor', 'dentista', 'odontologo', 'psicologo', 'psicologa', 'terapia', 'analisis', 'obra social', 'kinesiologo', 'kinesiologia', 'guardia', 'consulta', 'anteojos', 'lentes', 'gimnasio', 'gym', 'suplementos', 'proteina', 'creatina', 'nutricionista'],
    subs: ['netflix', 'spotify', 'disney', 'hbo', 'max', 'prime', 'amazon prime', 'youtube', 'icloud', 'suscripcion', 'suscripciones', 'chatgpt', 'claude', 'google one', 'apple music', 'apple tv', 'paramount', 'star plus', 'crunchyroll', 'twitch', 'patreon', 'xbox game pass', 'playstation plus', 'office', 'microsoft', 'canva', 'dropbox', 'mubi', 'deezer', 'tidal'],
    ropa: ['ropa', 'zapatillas', 'zapatilla', 'remera', 'remeras', 'pantalon', 'pantalones', 'jean', 'jeans', 'campera', 'buzo', 'zapatos', 'medias', 'camisa', 'vestido', 'pollera', 'short', 'malla', 'botas', 'ojotas', 'gorra', 'bufanda', 'ropa interior', 'calzoncillos', 'corpino', 'zara', 'nike', 'adidas', 'shopping', 'tintoreria', 'lavanderia'],
    ocio: ['cine', 'teatro', 'recital', 'show', 'entrada', 'entradas', 'salida', 'boliche', 'juego', 'juegos', 'videojuego', 'steam', 'playstation', 'libro', 'libros', 'viaje', 'vacaciones', 'hotel', 'bowling', 'futbol', 'cancha', 'paddle', 'padel', 'museo', 'escapada', 'finde', 'fiesta', 'hobby', 'bar de copas', 'karaoke', 'airbnb', 'excursion'],
    ahorro: ['ahorro', 'ahorre', 'ahorrar', 'dolares', 'dolar', 'plazo fijo', 'inversion', 'invertir', 'inverti', 'fci', 'fondo comun', 'cripto', 'usdt', 'bitcoin', 'acciones', 'cedears', 'bonos', 'mercado pago rinde', 'caja de ahorro'],
    otros: ['regalo', 'regalos', 'donacion', 'propina', 'cerrajero', 'llaves', 'mascota', 'veterinaria', 'veterinario', 'alimento del perro', 'peluqueria', 'barberia', 'corte de pelo', 'correo', 'envio', 'fotocopias', 'libreria', 'multa'],
    sueldo: ['sueldo', 'salario', 'aguinaldo', 'haberes', 'recibo', 'bono', 'vacaciones pagas'],
    extra: ['freelance', 'changa', 'changas', 'trabajo', 'trabajito', 'cliente', 'proyecto', 'honorarios', 'plano', 'planos', 'factura', 'facture', 'clases', 'clase particular', 'consultoria'],
    'otros-ing': ['venta', 'vendi', 'reintegro', 'devolucion', 'me devolvieron', 'cashback', 'intereses', 'rendimiento', 'premio', 'me regalaron', 'regalo', 'prestamo', 'me prestaron', 'transferencia'],
  };

  const INCOME_RX = /\b(cobre|cobro|cobramos|cobraste|me pagaron|me pago|me depositaron|me transfirieron|ingreso|ingresaron|ingresos|entro|entraron|me entro|me entraron|gane|ganamos|vendi|recibi|sueldo|aguinaldo|salario|me devolvieron|reintegro|me regalaron|me prestaron)\b/;
  const EXPENSE_RX = /\b(gaste|gastamos|gasto|gastos|pague|pagamos|compre|compramos|puse|saque|me cobraron|me salio|salio|costo|invite|cargue|done|aboné|abone|transferi)\b/;
  const QUERY_RX = /^[\s¿¡"']*(cuanto|que tanto|en cuanto)\b/;

  const STOP = new Set(('gaste gastamos gasto gastos pague pagamos compre compramos cobre cobro cobramos cobraste me te pagaron pago ' +
    'vendi vendimos depositaron transfirieron ingreso ingresaron entro entraron gane ganamos recibi puse saque salio costo cobraron invite cargue ' +
    'en de del el la los las un una unos unas por para pesos peso mangos y con mi mis al a lo que fue fueron hoy ayer anteayer ' +
    'anotar anota anota agregar agrega sumar suma sumale cargar carga registrar registra nuevo nueva o u se es son este esta ' +
    'eso algo cosa cosas varios varias total aprox aproximadamente como mas menos le les tipo onda dale bueno mira che').split(' '));

  function scoreCategories(textNorm, categories, learned) {
    const words = textNorm.split(/\s+/).filter(Boolean);
    const scores = new Map();
    const add = (id, v) => scores.set(id, (scores.get(id) || 0) + v);
    for (const c of categories) {
      const kws = new Set((KEYWORDS[c.id] || []).map(norm));
      norm(c.name).split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).forEach(w => kws.add(w));
      for (const k of kws) {
        if (k.includes(' ')) { if ((' ' + textNorm + ' ').includes(' ' + k + ' ')) add(c.id, 3); }
        else if (words.includes(k)) add(c.id, 2);
        else if (k.length >= 5 && words.some(w => w.startsWith(k) || (w.length >= 5 && k.startsWith(w)))) add(c.id, 1);
      }
    }
    if (learned) for (const w of words) {
      const id = learned[w];
      if (id && categories.some(c => c.id === id)) add(id, 5);
    }
    return scores;
  }

  function splitParts(text) {
    // "5000 de nafta y 3000 en café" → dos partes; "treinta y cinco mil" no se corta
    const pieces = text.split(/\s+y\s+|\s*,\s+(?=\D)/i);
    if (pieces.length < 2) return [text];
    const out = [pieces[0]];
    for (let i = 1; i < pieces.length; i++) {
      const prevToks = tokenize(out[out.length - 1]);
      const lastPrev = prevToks.length ? prevToks[prevToks.length - 1].n : '';
      const curAmt = findAmount(tokenize(pieces[i]));
      const prevAmt = findAmount(prevToks);
      const firstCur = (tokenize(pieces[i])[0] || {}).n || '';
      const joinsNumber = TENS.has(lastPrev) || (lastPrev in MULT && (firstCur === 'medio' || firstCur === 'media'));
      if (!joinsNumber && curAmt && prevAmt) out.push(pieces[i]);
      else out[out.length - 1] += ' y ' + pieces[i];
    }
    return out;
  }

  function tokenize(text) {
    return String(text)
      .replace(/(\$)\s*(?=\d)/g, '$1')
      .replace(/(\d)\s*\$/g, '$1 $')
      .split(/\s+/)
      .map(raw => raw.replace(/^[¿¡"'(]+|[?!"'):;]+$/g, '').replace(/\.$/, ''))
      .filter(Boolean)
      .map(raw => ({raw, n: norm(raw).replace(/^\$(?=\D)/, '')}));
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function interpretOne(text, ctx) {
    const today = ctx.today || new Date();
    const cats = ctx.categories || [];
    const learned = ctx.learned || {};
    const dt = findDate(text, today);
    let working = text;
    if (dt.match) {
      // saca la expresión de fecha del texto original (comparando sin tildes)
      const nt = norm(working), idx = nt.indexOf(dt.match);
      if (idx >= 0) working = working.slice(0, idx) + ' ' + working.slice(idx + dt.match.length);
    }
    const toks = tokenize(working);
    const amt = findAmount(toks);
    const rest = toks.filter((_, i) => !amt || i < amt.start || i >= amt.end);
    const restNorm = rest.map(t => t.n).join(' ');
    const fullNorm = norm(text);

    let type = null;
    if (EXPENSE_RX.test(fullNorm)) type = 'gasto';
    else if (INCOME_RX.test(fullNorm)) type = 'ingreso';

    const pool = type ? cats.filter(c => c.type === type) : cats;
    const scores = scoreCategories(restNorm, pool, learned);
    let best = null, bestScore = 0;
    for (const c of pool) { const s = scores.get(c.id) || 0; if (s > bestScore) { best = c; bestScore = s; } }
    if (!type) type = best ? best.type : 'gasto';
    const fallback = type === 'gasto' ? 'otros' : 'otros-ing';
    const catId = best && best.type === type ? best.id : (cats.find(c => c.id === fallback) ? fallback : (cats.find(c => c.type === type) || {}).id);

    const noteWords = rest.filter(t => !STOP.has(t.n) && !CURRENCY.has(t.n) && !/^\d/.test(t.n)).map(t => t.raw);
    const note = cap(noteWords.join(' ').slice(0, 60));

    return {
      kind: 'add',
      ok: !!amt,
      type,
      amount: amt ? Math.round(amt.value * 100) / 100 : null,
      catId,
      matched: !!best,
      date: dt.date,
      note,
      words: rest.map(t => t.n).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w)),
      source: text.trim(),
    };
  }

  function interpretQuery(text, ctx) {
    const t = norm(text);
    const type = /\b(cobre|entro|entraron|ingrese|ingresos|gane|ganamos)\b/.test(t) ? 'ingreso' : 'gasto';
    let period = 'mes';
    if (/\bhoy\b/.test(t)) period = 'hoy';
    else if (/\bayer\b/.test(t)) period = 'ayer';
    else if (/\bsemana\b/.test(t)) period = 'semana';
    else if (/\bmes pasado\b/.test(t)) period = 'mes-pasado';
    else if (/\b(ano|anio)\b/.test(t)) period = 'anio';
    const cleaned = t.replace(/\b(cuanto|que tanto|en cuanto|llevo|llevamos|gaste|gastamos|gastado|cobre|entro|entraron|ingrese|gane|ganamos|este|esta|el|la|los|las|en|de|del|mes|pasado|semana|hoy|ayer|ano|anio|va|van|me|lo|que|total|con|por|plata|dinero)\b/g, ' ').replace(/[?¿!¡.,]/g, ' ').replace(/\s+/g, ' ').trim();
    const pool = (ctx.categories || []).filter(c => c.type === type);
    const scores = scoreCategories(cleaned, pool, ctx.learned);
    let best = null, bs = 0;
    for (const c of pool) { const s = scores.get(c.id) || 0; if (s > bs) { best = c; bs = s; } }
    return {kind: 'query', type, period, catId: best ? best.id : null, term: best ? '' : cleaned};
  }

  function interpret(text, ctx) {
    const clean = String(text || '').trim();
    if (!clean) return [];
    if (QUERY_RX.test(norm(clean))) return [interpretQuery(clean, ctx)];
    return splitParts(clean).map(p => interpretOne(p, ctx));
  }

  const keyWords = s => tokenize(s).map(t => t.n).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w));
  const api = {interpret, norm, keyWords, _findAmount: t => findAmount(tokenize(t)), KEYWORDS};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VozParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
