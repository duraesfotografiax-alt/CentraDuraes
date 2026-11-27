// Contratos assinados pelo cliente no link (assinar.html): marca o contrato como assinado e avisa os administradores.
module.exports = async function assinaturas({ db, usuarios, enviar, ehAdm }) {
  const sn = await db.collection('assinaturas').where('status', '==', 'assinado').where('notificado', '==', false).get();
  for (const d of sn.docs) {
    const a = d.data();
    try {
      const quando = a.assEm && a.assEm.toDate ? a.assEm.toDate().toISOString() : new Date().toISOString();
      if (a.contratoId) {
        const ref = db.collection('contratos').doc(a.contratoId);
        if ((await ref.get()).exists) await ref.update({ status: 'assinado', assinadoEm: quando, assinaturaId: d.id });
      }
      await d.ref.update({ notificado: true });
      const nome = (a.ass && a.ass.nome) || a.nome || 'O cliente';
      console.log(`Contrato ${a.numero} assinado por ${nome}`);
      if (enviar) for (const u of usuarios.filter(ehAdm)) await enviar(u, 'Contrato assinado', `${nome} assinou o contrato ${a.numero}.`);
    } catch (e) { console.error('Assinaturas:', e.message); }
  }
};
