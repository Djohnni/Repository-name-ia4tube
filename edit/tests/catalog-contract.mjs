// Pinned to the released catalog at e946b3e2, before the 16 additive models.
export const LEGACY_IDS = [
  '4bb25879-a745-4577-812a-5a94286e324c',
  '7503ea91-b4f7-41eb-9869-be10f23df935',
  'b142f07c-6fb2-4b99-842f-b12817c88df3',
  'd90dda14-dd61-4526-8882-50d4952b0359',
  'cc2ff272-4fbf-404c-b5a0-3a5ece29b15d',
  '15e9b9a7-c367-4724-90b5-d3c202641def',
  'af9ba4d1-2fb3-43cd-90f2-2a4cb5c8a7e0',
  '2830b796-2375-49e8-8e97-9a731c115252',
];
export const LEGACY_CATALOG_SHA256 = '4df224bc00764b8f061603feb2862674c15911fdef8da03901dd92144f102004';
export const legacyItems = catalog => catalog.catalog.filter(item => LEGACY_IDS.includes(item.id));

// The approved new identifiers and quotes are intentionally pinned in tests,
// independent of the runtime catalog whose content these tests validate.
export const NEW_MODELS = [
  ['9ca2a07a-58f4-4861-8648-45bab3fb8029','chef-ta-on-v1',2600,'O CHEF TÁ ON.'],
  ['551bf202-0047-4ae2-9bdf-4d6381835f12','zerei-a-fome-v1',2500,'ZEREI A FOME.'],
  ['545f3533-542c-4a82-a588-0de60f140e67','so-vim-olhar-v1',2800,'SÓ VIM OLHAR...'],
  ['07f18ce7-6ec8-4b9d-9bf7-ee11c288f52a','chegou-o-brabo-v1',2400,'CHEGOU O BRABO.'],
  ['9687627a-a78e-4ab9-8f05-f02c3e6b0ecd','grupo-decidiu-v1',2300,'O GRUPO JÁ DECIDIU.\nPARTIU LANCHE?\nBORA!'],
  ['5f6f2ff8-05a0-4cdb-a95e-fdff3d196633','quadrinhos-pop-v1',2300,'FOME? JÁ ERA!'],
  ['e0551646-c5a5-4e9b-aa0d-e6de666f2c65','papel-recortado-v1',2500,'SABOR EM OUTRA CAMADA.'],
  ['b8a5500a-321c-4ac3-a506-089981bb619f','diner-retro-v1',2400,'CLÁSSICO DE RESPEITO.'],
  ['c61c9641-102a-46db-8b57-075da2fd7265','minimalista-premium-v1',2100,'MENOS PAPO. MAIS SABOR.'],
  ['c9e48a7f-1e9d-4b40-98da-df9cb0e9145e','outro-mundo-v1',2700,'DE OUTRO MUNDO.'],
  ['17e06b89-5ca2-4db6-ba95-7e0ba81565db','dia-de-jogo-v1',2400,'A FOME PERDEU.'],
  ['a7ebf819-48a4-456e-86c5-78a671dd2f56','western-procurado-v1',2200,'PROCURADO PELA FOME.'],
  ['d4678eac-46a2-4de6-9c99-f66b14c7edae','preguica-delivery-v1',2800,'HOJE EU SÓ PEÇO.'],
  ['2aab4aaa-d06e-457f-867e-2ec621f82407','arte-de-rua-v1',2300,'O SABOR É DA RUA.'],
  ['c65c2636-723e-4e7a-9aae-01b0aae7d26c','mundo-massinha-v1',2700,'FOME DE DIVERSÃO.'],
  ['cfcc6a78-9112-4058-b1c3-f39174dcc1ed','depois-do-voto-v1',2200,'DEPOIS DO VOTO, BORA DE LANCHE.'],
];

// Separate example identities; existing recipes and their price/phrase stay fixed.
export const PIZZA_EXAMPLES = [
  ['0a38a604-2858-4395-a980-9977e130ce2c','minimalista-premium-v1',2100,
    'MENOS PAPO. MAIS SABOR.','Pizza · Menos papo. Mais sabor','pizza-minimalista'],
  ['53b147d4-23c8-447b-9b03-aee70a57693d','diner-retro-v1',2400,
    'CLÁSSICO DE RESPEITO.','Pizza · Clássico de respeito','pizza-retro'],
  ['088347f6-b7c6-4ad4-bc01-3608edfc3277','dia-de-jogo-v1',2400,
    'A FOME PERDEU.','Pizza · A fome perdeu','pizza-jogo'],
];
export const PRE_PIZZA_CATALOG_SHA256 = '6336aaf9a2c3e4d074a219eda79e08f4493ad7746e8de906b5543e841fd63cc6';
