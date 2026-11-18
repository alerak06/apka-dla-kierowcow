import { decodeVin } from '../lib/carImage.js';
import { bumpQuota } from '../lib/quota.js';

export const access = 'user';
export const methods = ['GET'];

// przy dodawaniu auta: VIN -> marka, model, rocznik, silnik, moc, skrzynia
export default async function (req, res) {
  const vin = String(req.query.vin || '').trim().toUpperCase();

  // 17 znakow, bez I, O i Q (zeby nie mylily sie z 1 i 0)
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return res.status(400).json({ error: 'VIN ma 17 znaków (cyfry i litery, bez I, O, Q).' });
  }

  try {
    await bumpQuota('vin'); // limit zapytan do zewnetrznego API
    res.json(await decodeVin(vin));
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
}
