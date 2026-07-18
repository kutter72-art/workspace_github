
/* ════════════════════════════════════════════════════
   PPTX 저장  (JSZip + 원본 템플릿 마스터 유지)
════════════════════════════════════════════════════ */

const TEMPLATE_B64 = '__TEMPLATE_B64__';

function xmlEsc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function htmlParas(html) {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  const paras = [];
  function walk(node) {
    if (node.nodeType === 3) {
      const t = node.textContent.trim();
      if (t) paras.push({ type: 'normal', text: t });
      return;
    }
    if (node.nodeType !== 1) return;
    const cls = node.className || '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'img') return;
    if (cls.includes('sq-heading')) {
      const t = node.textContent.trim();
      if (t) paras.push({ type: 'heading', text: t });
    } else if (cls.includes('bullet-item')) {
      const t = node.textContent.trim();
      if (t) paras.push({ type: 'bullet', text: t });
    } else if (tag === 'br') {
      paras.push({ type: 'empty' });
    } else {
      const hasBlock = [...node.childNodes].some(c =>
        c.nodeType === 1 && ['DIV','P','BR'].includes(c.tagName));
      if (hasBlock) {
        for (const c of node.childNodes) walk(c);
      } else {
        const t = node.textContent.trim();
        if (t) paras.push({ type: 'normal', text: t });
      }
    }
  }
  for (const c of div.childNodes) walk(c);
  return paras;
}

function parasToOoxml(paras) {
  const F = '<a:latin typeface="맑은 고딕" pitchFamily="50" charset="-127"/><a:ea typeface="맑은 고딕" pitchFamily="50" charset="-127"/>';
  const rpr = (b) => '<a:rPr lang="ko-KR" altLang="en-US" sz="1200"' + (b ? ' b="1"' : '') + ' dirty="0">' + F + '</a:rPr>';
  const run = (t, b) => '<a:r>' + rpr(b) + '<a:t>' + xmlEsc(t) + '</a:t></a:r>';
  const eP  = () => '<a:p><a:endParaRPr lang="ko-KR" altLang="en-US" sz="1200" dirty="0">' + F + '</a:endParaRPr></a:p>';
  if (!paras || !paras.length) return eP();
  return paras.map(function(p) {
    if (p.type === 'heading') return '<a:p>' + run(p.text, true) + '</a:p>';
    if (p.type === 'bullet')  return '<a:p><a:pPr marL="342900" indent="-342900"><a:buNone/></a:pPr>' + run(p.text, false) + '</a:p>';
    if (p.type === 'empty')   return eP();
    return '<a:p>' + run(p.text, false) + '</a:p>';
  }).join('');
}

function buildSlideXml(slide) {
  const leftXml  = parasToOoxml(htmlParas(slide.leftHtml));
  const rightXml = parasToOoxml(htmlParas(slide.rightHtml));
  const title = slide.month + '월 ' + slide.week + '주차 주간 보고_' + slide.team;

  function lnS(tag) {
    return '<a:' + tag + ' w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:prstDash val="solid"/><a:round/><a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/></a:' + tag + '>';
  }
  function lnN(tag) {
    return '<a:' + tag + ' w="6350" cap="flat" cmpd="sng" algn="ctr"><a:noFill/><a:prstDash val="solid"/><a:round/><a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/></a:' + tag + '>';
  }
  const allBorder = lnS('lnL') + lnS('lnR') + lnS('lnT') + lnS('lnB');

  function hdrCell(txt) {
    return '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>'
      + '<a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>'
      + '<a:r><a:rPr lang="ko-KR" altLang="en-US" sz="1400" dirty="0">'
      + '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>'
      + '<a:t>' + xmlEsc(txt) + '</a:t></a:r></a:p>'
      + '</a:txBody>'
      + '<a:tcPr>' + allBorder + '<a:solidFill><a:schemeClr val="bg1"><a:lumMod val="95000"/></a:schemeClr></a:solidFill></a:tcPr>'
      + '</a:tc>';
  }

  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
    + '<p:cSld><p:spTree>'
    + '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="4" name="슬라이드 번호 개체 틀 3"/>'
    + '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
    + '<p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="-6207" y="6669360"/><a:ext cx="9150207" cy="182062"/></a:xfrm></p:spPr>'
    + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"><a:defRPr/></a:pPr>'
    + '<a:fld id="{6672085B-8B2F-4A51-AFDE-E0DD93C09D73}" type="slidenum">'
    + '<a:rPr lang="en-US" altLang="ko-KR" smtClean="0"><a:solidFill><a:schemeClr val="bg1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></a:rPr>'
    + '<a:pPr algn="ctr"><a:defRPr/></a:pPr><a:t>1</a:t></a:fld></a:p></p:txBody></p:sp>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="3" name="TextBox 2"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="179512" y="116632"/><a:ext cx="4692310" cy="461665"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
    + '<p:txBody><a:bodyPr wrap="none" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>'
    + '<a:p><a:r><a:rPr lang="ko-KR" altLang="en-US" sz="2400" b="1" dirty="0" smtClean="0">'
    + '<a:latin typeface="+mn-ea"/><a:ea typeface="+mn-ea"/></a:rPr>'
    + '<a:t>' + xmlEsc(title) + '</a:t></a:r></a:p></p:txBody></p:sp>'
    + '<p:graphicFrame><p:nvGraphicFramePr>'
    + '<p:cNvPr id="5" name="표 4"/>'
    + '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>'
    + '<p:nvPr/></p:nvGraphicFramePr>'
    + '<p:xfrm><a:off x="212412" y="791340"/><a:ext cx="8712968" cy="5440327"/></p:xfrm>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + '<a:tbl><a:tblPr firstRow="1" bandRow="1">'
    + '<a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr>'
    + '<a:tblGrid><a:gridCol w="6519828"/><a:gridCol w="2193140"/></a:tblGrid>'
    + '<a:tr h="159847">' + hdrCell('금주 실적 ') + hdrCell('차주계획') + '</a:tr>'
    + '<a:tr h="4571647">'
    + '<a:tc rowSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/>' + leftXml + '</a:txBody>'
    + '<a:tcPr>' + allBorder + '<a:noFill/></a:tcPr></a:tc>'
    + '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>' + rightXml + '</a:txBody>'
    + '<a:tcPr>' + lnS('lnL') + lnS('lnR') + lnS('lnT') + lnN('lnB') + '<a:noFill/></a:tcPr></a:tc>'
    + '</a:tr>'
    + '<a:tr h="445913">'
    + '<a:tc vMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR" altLang="en-US" sz="1200" dirty="0"/></a:p></a:txBody>'
    + '<a:tcPr>' + allBorder + '<a:noFill/></a:tcPr></a:tc>'
    + '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR" altLang="en-US" sz="1200" dirty="0"/></a:p></a:txBody>'
    + '<a:tcPr>' + lnS('lnL') + lnS('lnR') + lnN('lnT') + lnS('lnB') + '<a:noFill/></a:tcPr></a:tc>'
    + '</a:tr>'
    + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
    + '</p:spTree></p:cSld>'
    + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
    + '<p:transition><p:strips/></p:transition>'
    + '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"/></p:par></p:tnLst></p:timing>'
    + '</p:sld>';
}

async function savePptx() {
  if (!slides.length) { alert('저장할 슬라이드가 없습니다.'); return; }
  const btn = document.getElementById('btnPptx');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 생성 중...'; }
  setStatus('PPTX 생성 중...');
  try {
    const bStr = atob(TEMPLATE_B64);
    const bytes = new Uint8Array(bStr.length);
    for (let i = 0; i < bStr.length; i++) bytes[i] = bStr.charCodeAt(i);
    const zip = await JSZip.loadAsync(bytes.buffer);

    zip.remove('ppt/slides/slide1.xml');
    zip.remove('ppt/slides/_rels/slide1.xml.rels');

    for (let i = 0; i < slides.length; i++) {
      const n = i + 1;
      zip.file('ppt/slides/slide' + n + '.xml', buildSlideXml(slides[i]));
      zip.file('ppt/slides/_rels/slide' + n + '.xml.rels',
        '<?xml version="1.0" encoding="utf-8"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>'
        + '</Relationships>');
    }

    let presXml = await zip.file('ppt/presentation.xml').async('string');
    const sldIds = slides.map(function(_, i) {
      return '<p:sldId id="' + (576 + i) + '" r:id="rId' + (9 + i) + '"/>';
    }).join('');
    presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, '<p:sldIdLst>' + sldIds + '</p:sldIdLst>');
    zip.file('ppt/presentation.xml', presXml);

    let presRels = await zip.file('ppt/_rels/presentation.xml.rels').async('string');
    presRels = presRels.replace(/<Relationship Id="rId9"[^/]*\/>\s*/g, '');
    const newRels = slides.map(function(_, i) {
      return '<Relationship Id="rId' + (9 + i) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (i + 1) + '.xml"/>';
    }).join('\n  ');
    presRels = presRels.replace('</Relationships>', '  ' + newRels + '\n</Relationships>');
    zip.file('ppt/_rels/presentation.xml.rels', presRels);

    let ct = await zip.file('[Content_Types].xml').async('string');
    ct = ct.replace(/<Override PartName="\/ppt\/slides\/slide1\.xml"[^/]*\/>\s*/g, '');
    const newOvr = slides.map(function(_, i) {
      return '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
    }).join('\n  ');
    ct = ct.replace('</Types>', '  ' + newOvr + '\n</Types>');
    zip.file('[Content_Types].xml', ct);

    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      compression: 'DEFLATE', compressionOptions: { level: 6 }
    });
    const today = new Date();
    const fname = '주간보고서_' + today.getFullYear()
      + String(today.getMonth() + 1).padStart(2, '0')
      + String(today.getDate()).padStart(2, '0') + '.pptx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
    URL.revokeObjectURL(url);
    setStatus('PPTX 저장 완료: ' + fname);
  } catch(e) {
    console.error(e);
    alert('PPTX 생성 오류: ' + e.message);
    setStatus('PPTX 오류');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 PPTX 저장'; }
  }
}
