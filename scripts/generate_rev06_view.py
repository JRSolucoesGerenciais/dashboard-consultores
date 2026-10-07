from pathlib import Path

source_path = Path('/home/ubuntu/upload/pasted_content.txt')
output_path = Path('/home/ubuntu/cs-project-management/SQL-Cronograma-de-Projetos-REV06-VIEW.sql')
src = source_path.read_text()
header_end = src.index('WITH cron_ppsa AS (')
header = """/*
  View de planejamento REV06 para a Gestão 360° CS Compusoftware.
  A View retorna todos os projetos. O filtro por projeto deve ser aplicado
  na consulta consumidora, por exemplo usando o código do projeto recebido.

  Regras preservadas da SQL recebida:
  - 40 horas por semana (5 dias x 8 horas);
  - rateio direto por UTILIZACAO_PERC limitado por MAX_UTILIZACAO;
  - consolidação PPSA N4 -> N3 -> N2 -> N1;
  - horas realizadas mantidas da origem.
  A View não classifica produtividade oficial; o aplicativo separa apenas
  vínculo ao cronograma (IDPROJETOCRONOGRAMA) para fins de escopo.
*/

CREATE OR REPLACE VIEW CSAGENDA_PLANEJAMENTO_REV06_VW AS
"""
src = header + src[header_end:]
src = src.replace('N3 -> N2 -> N1 ja existente', 'N4 -> N3 -> N2 -> N1 ja existente')
replacements = {
    'p.nivel IN (1, 2, 3)': 'p.nivel IN (1, 2, 3, 4)',
    'ippsa.nivel IN (1, 2, 3)': 'ippsa.nivel IN (1, 2, 3, 4)',
    '      AND (NVL(:P_PROJETO, 0) = 0 OR ipc.cod_projeto = :P_PROJETO)\n': '',
    '    WHERE (NVL(:P_PROJETO, 0) = 0 OR pm.id_projeto = :P_PROJETO)\n': '    WHERE 1 = 1\n',
    '                             AND (NVL(:P_PROJETO, 0) = 0 OR ip.cod_projeto = :P_PROJETO)\n': '',
    'AND (NVL(:P_PROJETO, 0) = 0 OR horas_apont.cod_projeto = :P_PROJETO)\n': '',
    'and (NVL(:P_PROJETO, 0) = 0 OR tmp.cod_projeto = :P_PROJETO)\n': '',
}
for old, new in replacements.items():
    src = src.replace(old, new)
old_final = """WHERE (
    tmp.nivel = 1 
    OR (
        ((tmp.codgestao = 0) or (0 = 0) or (0 is null))
        and ((tmp.codmodulo = 0) or (0 = 0) or (0 is null))
    )
)
and (
    tmp.pass_date_filter = 1
    or (tmp.nivel = 2 and tmp.has_n3_valid = 1)
    or (tmp.nivel = 1 and tmp.has_descendant_valid = 1)
);"""
if old_final not in src:
    raise RuntimeError('Filtro final REV06 não encontrado; não gerar uma View incompleta.')
src = src.replace(old_final, 'WHERE 1 = 1;')
if ':P_' in src:
    raise RuntimeError('A DDL ainda contém bind de tela.')
output_path.write_text(src)
print(f'created {output_path} ({len(src.splitlines())} lines)')
