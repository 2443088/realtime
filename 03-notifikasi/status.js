// Aturan status surat: sama dengan enum StatusSurat di Laravel (pertemuan 9).
export const STATUS = {
  diajukan: { label: 'Diajukan', berikutnya: ['diproses', 'ditolak'] },
  diproses: { label: 'Diproses', berikutnya: ['selesai', 'ditolak'] },
  selesai:  { label: 'Selesai',  berikutnya: [] },
  ditolak:  { label: 'Ditolak',  berikutnya: [] },
};

export const statusValid = (s) => typeof s === 'string' && Object.hasOwn(STATUS, s);

export const bisaBerubah = (dari, ke) => STATUS[dari].berikutnya.includes(ke);

/** Bentuk surat yang dikirim ke client. */
export const tampil = (s) => ({
  ...s,
  status_label: STATUS[s.status].label,
  berikutnya: STATUS[s.status].berikutnya,
});
