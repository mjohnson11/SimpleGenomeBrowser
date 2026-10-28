import * as aq from 'https://cdn.jsdelivr.net/npm/arquero@8.0.3/+esm';


async function fetch_server_data(fetch_path, json_object) {
  // Retrieves data from a parquet/arrow endpoint on the server and returns an Arquero table
  const response = await fetch(fetch_path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json_object),
  });
  
  if (!response.ok) {
    try {
      const errorData = await response.json();
      console.error("Error fetching data:", errorData.error || response.statusText);
    } catch (e) {
      console.error("Error fetching data:", response.statusText);
    }
    return aq.table({});
  }
  
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const table = aq.fromArrow(bytes);

  if (json_object && ('data_log_message' in json_object)) {
    console.log(json_object.data_log_message, table.objects());
  }
  
  return table;
} 

function parse_fasta(data) {
  const seq_dict = {};
  let currentSeq = "";
  let currentSeqName = "";
  data.split(/\r?\n/).forEach(line => {
    if (line.startsWith(">")) {
      if (currentSeqName) {
        seq_dict[currentSeqName] = currentSeq;
      }
      currentSeqName = line.slice(1).trim().split(/\s+/)[0];
      currentSeq = "";
    } else {
      currentSeq += line.trim();
    }
  });
  if (currentSeqName) {
    seq_dict[currentSeqName] = currentSeq;
  }
  return seq_dict;
}

async function load_fasta(fasta_file_or_text) {
  if (typeof fasta_file_or_text === 'string' && fasta_file_or_text.trimStart().startsWith('>')) {
    return parse_fasta(fasta_file_or_text);
  }
  const response = await fetch(fasta_file_or_text);
  if (!response.ok) {
    throw new Error(`Failed to load FASTA file (${response.status}): ${fasta_file_or_text}`);
  }
  const text = await response.text();
  return parse_fasta(text);
}

function parse_genbank_flatfile(text, default_circular = true) {
  const records = [];
  const raw_records = text.split(/^\/\/\s*$/m);

  for (const raw_rec of raw_records) {
    if (!raw_rec.trim()) continue;
    const lines = raw_rec.split(/\r?\n/);
    let name = null;
    let circular = default_circular;
    let section = null;
    const features = [];
    let current_feature = null;
    let current_qual_key = null;
    const seq_parts = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('LOCUS')) {
        // e.g. LOCUS       NC_000913            4641652 bp    DNA     circular BCT 01-JAN-2020
        const parts = line.trim().split(/\s+/);
        name = parts[1] || 'contig_1';
        if (/\bcircular\b/i.test(line)) {
          circular = true;
        } else if (/\blinear\b/i.test(line)) {
          circular = false;
        }
        section = 'HEADER';
      } else if (line.startsWith('VERSION')) {
        const vparts = line.trim().split(/\s+/);
        // Keep LOCUS name unless it was missing
        if (!name && vparts[1]) name = vparts[1];
      } else if (line.startsWith('FEATURES')) {
        section = 'FEATURES';
      } else if (line.startsWith('ORIGIN')) {
        section = 'ORIGIN';
        current_feature = null;
      } else if (/^[A-Z]+/.test(line)) {
        section = 'OTHER';
        current_feature = null;
      } else if (section === 'FEATURES') {
        // Feature header has type in cols 5..20 and location starting at col 21
        const feat_match = line.match(/^     (\S+)\s+(.+)$/);
        if (feat_match) {
          const type = feat_match[1];
          let loc_str = feat_match[2].trim();
          // Location might wrap across multiple lines before the first /qualifier
          while (i + 1 < lines.length && /^ {21}[^/]/.test(lines[i + 1])) {
            i++;
            loc_str += lines[i].trim();
          }
          const strand = loc_str.includes('complement') ? -1 : 1;
          const coords = Array.from(loc_str.matchAll(/(\d+)\.\.[><]?(\d+)/g));
          let start = 0;
          let end = 0;
          if (coords.length > 0) {
            start = parseInt(coords[0][1], 10);
            end = parseInt(coords[coords.length - 1][2], 10);
          } else {
            const single = loc_str.match(/(\d+)/);
            if (single) {
              start = parseInt(single[1], 10);
              end = start;
            }
          }
          current_feature = {
            type,
            start,
            end,
            strand,
            notes: {}
          };
          current_qual_key = null;
          features.push(current_feature);
        } else if (current_feature && /^ {21}\//.test(line)) {
          const qual_str = line.trim().slice(1);
          const eq_idx = qual_str.indexOf('=');
          if (eq_idx === -1) {
            current_qual_key = qual_str;
            current_feature.notes[current_qual_key] = [true];
          } else {
            current_qual_key = qual_str.slice(0, eq_idx);
            let val = qual_str.slice(eq_idx + 1);
            if (val.startsWith('"')) {
              val = val.slice(1);
              if (val.endsWith('"')) {
                val = val.slice(0, -1);
              }
            }
            if (!current_feature.notes[current_qual_key]) {
              current_feature.notes[current_qual_key] = [];
            }
            current_feature.notes[current_qual_key].push(val);
          }
        } else if (current_feature && current_qual_key && /^ {21}/.test(line)) {
          let cont = line.trim();
          if (cont.endsWith('"')) {
            cont = cont.slice(0, -1);
          }
          const arr = current_feature.notes[current_qual_key];
          if (arr && arr.length > 0 && typeof arr[arr.length - 1] === 'string') {
            const sep = current_qual_key === 'translation' ? '' : ' ';
            arr[arr.length - 1] += sep + cont;
          }
        }
      } else if (section === 'ORIGIN') {
        const cleaned = line.replace(/[^a-zA-Z]/g, '');
        if (cleaned) seq_parts.push(cleaned);
      }
    }

    if (name || seq_parts.length > 0) {
      records.push({
        name: name || `contig_${records.length + 1}`,
        circular,
        sequence: seq_parts.join(''),
        features
      });
    }
  }
  return records;
}

function parse_genbank(gb_input, default_circular = true) {
  // Accepts either raw GenBank flatfile text or pre-parsed GenBank JSON (array or single record)
  let records;
  if (typeof gb_input === 'string') {
    const trimmed = gb_input.trimStart();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      records = JSON.parse(trimmed);
    } else {
      records = parse_genbank_flatfile(gb_input, default_circular);
    }
  } else {
    records = gb_input;
  }
  if (!Array.isArray(records)) {
    records = [records];
  }

  const seqs = {};
  const circular_contigs = [];
  const features = [];
  const aa_seqs = {};

  for (const rec of records) {
    const contig_id = rec.name;
    seqs[contig_id] = rec.sequence || '';
    const is_circ = (rec.circular !== undefined)
      ? Boolean(rec.circular)
      : (rec.isCircular !== undefined ? Boolean(rec.isCircular) : default_circular);
    if (is_circ) {
      circular_contigs.push(contig_id);
    }
    if (Array.isArray(rec.features)) {
      for (const feat of rec.features) {
        const notes = feat.notes || {};
        const locusId = (notes.locus_tag && notes.locus_tag[0]) || feat.name || `${contig_id}_${feat.start}_${feat.end}`;
        const name = (notes.gene && notes.gene[0]) || feat.name || locusId;
        const desc = (notes.product && notes.product[0]) || '';
        const translation = (notes.translation && notes.translation[0]) || null;
        if (translation) {
          aa_seqs[String(locusId)] = translation;
        }
        const strand = (feat.strand === 1 || feat.strand === '+') ? '+' : (feat.strand === -1 || feat.strand === '-') ? '-' : '+';
        features.push({
          scaffoldId: contig_id,
          type: feat.type,
          begin: feat.start,
          end: feat.end,
          strand,
          locusId: String(locusId),
          name: String(name),
          desc,
          pseudo: Boolean(notes.pseudo),
          translation,
          notes,
          gb_row: feat
        });
      }
    }
  }

  return { seqs, circular_contigs, features, aa_seqs };
}

async function load_genbank(url_or_data, default_circular = true) {
  if (typeof url_or_data === 'object' && url_or_data !== null) {
    return parse_genbank(url_or_data, default_circular);
  }
  if (typeof url_or_data === 'string' && (/^\s*LOCUS\b/.test(url_or_data) || /^\s*[\[{]/.test(url_or_data))) {
    return parse_genbank(url_or_data, default_circular);
  }
  const response = await fetch(url_or_data);
  if (!response.ok) {
    throw new Error(`Failed to load GenBank file (${response.status}): ${url_or_data}`);
  }
  const text = await response.text();
  return parse_genbank(text, default_circular);
}

function fit_text(string, fontsize, max_width, shortened=false) {
  if ((measure_text(string, fontsize) > max_width) && (string.length > 1)) {
    return fit_text(string.slice(0, -1), fontsize, max_width, true) + (shortened ? '' : '...');
  } else {
    return string;
  }
}

// https://gist.github.com/tophtucker/62f93a4658387bb61e4510c37e2e97cf
function measure_text(string, fontSize = 10) {
  if (!string) return 0;
  const widths = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.2796875,0.2765625,0.3546875,0.5546875,0.5546875,0.8890625,0.665625,0.190625,0.3328125,0.3328125,0.3890625,0.5828125,0.2765625,0.3328125,0.2765625,0.3015625,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.2765625,0.2765625,0.584375,0.5828125,0.584375,0.5546875,1.0140625,0.665625,0.665625,0.721875,0.721875,0.665625,0.609375,0.7765625,0.721875,0.2765625,0.5,0.665625,0.5546875,0.8328125,0.721875,0.7765625,0.665625,0.7765625,0.721875,0.665625,0.609375,0.721875,0.665625,0.94375,0.665625,0.665625,0.609375,0.2765625,0.3546875,0.2765625,0.4765625,0.5546875,0.3328125,0.5546875,0.5546875,0.5,0.5546875,0.5546875,0.2765625,0.5546875,0.5546875,0.221875,0.240625,0.5,0.221875,0.8328125,0.5546875,0.5546875,0.5546875,0.5546875,0.3328125,0.5,0.2765625,0.5546875,0.5,0.721875,0.5,0.5,0.5,0.3546875,0.259375,0.353125,0.5890625];
  const avg = 0.5279276315789471;
  return String(string)
    .split('')
    .map(c => c.charCodeAt(0) < widths.length ? widths[c.charCodeAt(0)] : avg)
    .reduce((cur, acc) => acc + cur, 0) * fontSize;
}

function copy_sequence(sequence, button=null, reverse_comp=false) {
  const seq = reverse_comp ? reverse_complement(sequence) : sequence;
  navigator.clipboard.writeText(seq);
  const btn_node = button && (button.node ? button.node() : (button.innerHTML !== undefined ? button : null));
  if (btn_node) {
    const original_button_text = btn_node.innerHTML;
    btn_node.innerHTML = 'Copied!';
    setTimeout(() => {
      btn_node.innerHTML = original_button_text;
    }, 1000);
  }
}

function reverse_complement(string) {
  const complement = {
    'A': 'T',
    'T': 'A',
    'C': 'G',
    'G': 'C',
    'a': 't',
    't': 'a',
    'c': 'g',
    'g': 'c',
    'N': 'N',
    'n': 'n',
  };
  let rev_comp = '';
  for (let i = string.length - 1; i >= 0; i--) {
    const base = string[i];
    rev_comp += complement[base] || base;
  }
  return rev_comp;
}

function parse_gff(tdata, type_filter = 'CDS') {
  const lines = tdata.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
  const features = [];
  for (const line of lines) {
    const r = line.split('\t');
    if (r.length < 9) continue;
    const type = r[2];
    if (type_filter && type !== type_filter) continue;
    const row = {
      scaffoldId: r[0],
      type,
      begin: parseInt(r[3], 10),
      end: parseInt(r[4], 10),
      strand: r[6],
      phase: r[7],
      attributes: r[8]
    };
    for (const pair of row.attributes.split(';')) {
      if (!pair) continue;
      const eqIdx = pair.indexOf('=');
      if (eqIdx > -1) {
        const key = pair.slice(0, eqIdx).trim();
        const val = pair.slice(eqIdx + 1).trim();
        row[key] = val;
      }
    }
    row.locusId = String(row.locus_tag || row.ID || `${row.scaffoldId}_${row.begin}_${row.end}`);
    row.name = String(row.gene || row.Name || row.locusId);
    row.desc = row.product || '';
    features.push(row);
  }
  return features;
}

async function load_gff(gff_file_or_text, type_filter = 'CDS') {
  if (typeof gff_file_or_text === 'string' && (gff_file_or_text.startsWith('##gff') || gff_file_or_text.includes('\t'))) {
    return parse_gff(gff_file_or_text, type_filter);
  }
  const response = await fetch(gff_file_or_text);
  if (!response.ok) {
    throw new Error(`Failed to load GFF file (${response.status}): ${gff_file_or_text}`);
  }
  const text = await response.text();
  return parse_gff(text, type_filter);
}

async function load_gene_table(gene_file) {
  const table = await aq.loadCSV(gene_file, { delimiter: '\t' });
  return table;
}

// ============================================================================
// Alignment Parsers & Subtrack Packing (SAM, PAF, BLAST outfmt 6)
// ============================================================================

/**
 * Compute reference span, query length, and aligned block length from a CIGAR string.
 */
function calculate_cigar_stats(cigar) {
  if (!cigar || cigar === '*') {
    return { ref_span: 0, query_len: 0, query_start: 1, query_end: 0, block_len: 0 };
  }
  const cigarRegex = /(\d+)([MIDNSHPX=B])/g;
  let ref_span = 0;
  let query_len = 0;
  let block_len = 0;
  let clip_left = 0;
  let clip_right = 0;
  let seen_aligned = false;
  let match;

  while ((match = cigarRegex.exec(cigar)) !== null) {
    const len = parseInt(match[1], 10);
    const op = match[2];
    if (op === 'M' || op === 'D' || op === '=' || op === 'X' || op === 'N') {
      ref_span += len;
    }
    if (op === 'M' || op === 'I' || op === 'S' || op === '=' || op === 'X') {
      query_len += len;
    }
    if (op === 'H') {
      query_len += len;
    }
    if (op === 'M' || op === '=' || op === 'X' || op === 'I' || op === 'D') {
      block_len += len;
      seen_aligned = true;
    } else if (op === 'S' || op === 'H') {
      if (!seen_aligned) clip_left += len;
      else clip_right += len;
    }
  }

  return {
    ref_span,
    query_len,
    query_start: clip_left + 1,
    query_end: Math.max(clip_left + 1, query_len - clip_right),
    block_len
  };
}

/**
 * Parse optional SAM/PAF key:type:value tags (e.g. NM:i:5, cg:Z:100M, cs:Z::10*at, MD:Z:10A5).
 */
function parse_alignment_tags(fields, start_idx) {
  const tags = {};
  for (let i = start_idx; i < fields.length; i++) {
    const f = fields[i];
    if (!f || f.length < 5 || f[2] !== ':' || f[4] !== ':') continue;
    const key = f.slice(0, 2);
    const type = f[3];
    const rawVal = f.slice(5);
    tags[key] = (type === 'i' || type === 'f') ? Number(rawVal) : rawVal;
  }
  return tags;
}

/**
 * Parse SAM format text into normalized alignment objects (with backwards-compatible SAM properties).
 */
function parse_sam(sam_output) {
  const lines = String(sam_output || '').split(/\r?\n/);
  const alignments = [];

  for (const line of lines) {
    if (!line || line.startsWith('@')) continue;
    const fields = line.split('\t');
    if (fields.length < 10) continue;

    const flag = parseInt(fields[1], 10);
    if (flag & 0x4) continue; // unmapped

    const qname = fields[0];
    const rname = fields[2];
    const pos = parseInt(fields[3], 10); // 1-based reference start
    const mapq = parseInt(fields[4], 10);
    const cigar = fields[5];
    const rawSeq = fields[9] && fields[9] !== '*' ? fields[9].toUpperCase() : null;
    const tags = parse_alignment_tags(fields, 11);
    const cstats = calculate_cigar_stats(cigar);

    const end = pos + Math.max(1, cstats.ref_span);
    const seq_length = rawSeq ? rawSeq.length : cstats.query_len;
    const strand = (flag & 0x10) ? '-' : '+';

    let identity = null;
    if (tags.NM !== undefined && cstats.block_len > 0) {
      identity = Number((((cstats.block_len - tags.NM) / cstats.block_len) * 100).toFixed(1));
    }

    alignments.push({
      // Normalized alignment schema
      id: qname,
      contig: rname,
      start: pos,
      end: end,
      strand: strand,
      query_len: seq_length,
      query_start: cstats.query_start,
      query_end: cstats.query_end,
      score: Number.isNaN(mapq) ? null : mapq,
      identity: identity,
      group_id: qname,
      is_secondary: Boolean(flag & 0x100),
      is_supplementary: Boolean(flag & 0x800),
      cigar: cigar !== '*' ? cigar : (tags.cg || null),
      cs: tags.cs || null,
      md: tags.MD || null,
      seq: rawSeq,
      format: 'sam',
      meta: {
        flag,
        rnext: fields[6],
        pnext: parseInt(fields[7], 10),
        tlen: parseInt(fields[8], 10),
        nm: tags.NM ?? null,
        sa: tags.SA ?? null
      },
      // Backwards-compatible aliases
      qname,
      flag,
      rname,
      pos,
      mapq: Number.isNaN(mapq) ? 0 : mapq,
      seq_length
    });
  }

  return alignments;
}

/**
 * Parse PAF (Pairwise mApping Format) text into normalized alignment objects.
 */
function parse_paf(paf_text) {
  const lines = String(paf_text || '').split(/\r?\n/);
  const alignments = [];

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length < 12) continue;

    const qname = fields[0];
    const qlen = parseInt(fields[1], 10);
    const qstart = parseInt(fields[2], 10) + 1; // PAF is 0-based start -> 1-based
    const qend = parseInt(fields[3], 10);
    const strand = fields[4] === '-' ? '-' : '+';
    const rname = fields[5];
    const rlen = parseInt(fields[6], 10);
    const pos = parseInt(fields[7], 10) + 1; // PAF 0-based start -> 1-based inclusive
    const end = parseInt(fields[8], 10) + 1; // 1-based exclusive end
    const matches = parseInt(fields[9], 10);
    const block_len = parseInt(fields[10], 10);
    const mapq = parseInt(fields[11], 10);

    const tags = parse_alignment_tags(fields, 12);
    const identity = block_len > 0 ? Number(((matches / block_len) * 100).toFixed(1)) : null;
    const is_secondary = tags.tp === 'S' || tags.tp === 's';

    alignments.push({
      id: qname,
      contig: rname,
      start: pos,
      end: end,
      strand: strand,
      query_len: qlen,
      query_start: qstart,
      query_end: qend,
      score: Number.isNaN(mapq) ? null : mapq,
      identity: identity,
      group_id: qname,
      is_secondary: is_secondary,
      is_supplementary: tags.tp === 'I',
      cigar: tags.cg || null,
      cs: tags.cs || null,
      md: tags.MD || null,
      seq: null,
      format: 'paf',
      meta: {
        rlen,
        matches,
        block_len,
        nm: tags.NM ?? (block_len - matches),
        tp: tags.tp ?? 'P'
      },
      qname,
      flag: strand === '-' ? 0x10 : 0,
      rname,
      pos,
      mapq: Number.isNaN(mapq) ? 0 : mapq,
      seq_length: qlen
    });
  }

  return alignments;
}

/**
 * Parse 12-column BLAST / MMseqs2 tabular output (`outfmt 6`) into normalized alignment objects.
 * Columns: qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore
 */
function parse_blast6(tsv_text) {
  const lines = String(tsv_text || '').split(/\r?\n/);
  const alignments = [];

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const fields = line.split('\t');
    if (fields.length < 12) continue;

    const qname = fields[0];
    const rname = fields[1];
    const pident = parseFloat(fields[2]);
    const align_len = parseInt(fields[3], 10);
    const mismatch = parseInt(fields[4], 10);
    const gapopen = parseInt(fields[5], 10);
    const qstart = parseInt(fields[6], 10);
    const qend = parseInt(fields[7], 10);
    const sstart = parseInt(fields[8], 10);
    const send = parseInt(fields[9], 10);
    const evalue = parseFloat(fields[10]);
    const bitscore = parseFloat(fields[11]);

    if (Number.isNaN(sstart) || Number.isNaN(send)) continue;

    const strand = sstart <= send ? '+' : '-';
    const pos = Math.min(sstart, send);
    const end = Math.max(sstart, send) + 1; // 1-based exclusive end
    const q_min = Math.min(qstart, qend);
    const q_max = Math.max(qstart, qend);

    alignments.push({
      id: qname,
      contig: rname,
      start: pos,
      end: end,
      strand: strand,
      query_len: q_max - q_min + 1,
      query_start: q_min,
      query_end: q_max,
      score: Number.isNaN(bitscore) ? null : bitscore,
      identity: Number.isNaN(pident) ? null : Number(pident.toFixed(1)),
      group_id: qname,
      is_secondary: false,
      is_supplementary: false,
      cigar: null,
      cs: null,
      md: null,
      seq: null,
      format: 'blast6',
      meta: {
        align_len,
        mismatch,
        gapopen,
        evalue,
        bitscore
      },
      qname,
      flag: strand === '-' ? 0x10 : 0,
      rname,
      pos,
      mapq: Number.isNaN(bitscore) ? 0 : Math.round(bitscore),
      seq_length: align_len
    });
  }

  return alignments;
}

/**
 * Auto-detect and parse SAM, PAF, or BLAST outfmt 6 alignment text (or return already-parsed array).
 */
function parse_alignments(text_or_array, format = 'auto') {
  if (Array.isArray(text_or_array)) return text_or_array;
  const text = String(text_or_array || '');
  const fmt = (format || 'auto').toLowerCase();

  if (fmt === 'sam') return parse_sam(text);
  if (fmt === 'paf') return parse_paf(text);
  if (fmt === 'blast' || fmt === 'blast6' || fmt === 'm8') return parse_blast6(text);

  // Auto-detect from the first non-empty data line
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('@HD') || line.startsWith('@SQ') || line.startsWith('@PG')) {
      return parse_sam(text);
    }
    if (line.startsWith('#') || line.startsWith('@')) continue;
    const cols = line.split('\t');
    if (cols.length >= 12 && (cols[4] === '+' || cols[4] === '-') && /^\d+$/.test(cols[1]) && /^\d+$/.test(cols[6])) {
      return parse_paf(text);
    }
    if (cols.length >= 10 && (/^(\d+[MIDNSHPX=B])+$/.test(cols[5]) || cols[5] === '*') && /^\d+$/.test(cols[1])) {
      return parse_sam(text);
    }
    if (cols.length >= 12 && !Number.isNaN(parseFloat(cols[2])) && /^\d+$/.test(cols[8]) && /^\d+$/.test(cols[9])) {
      return parse_blast6(text);
    }
  }
  return parse_sam(text);
}

/**
 * Fetch or parse alignments from a URL, raw text, or array.
 */
async function load_alignments(url_or_data, format = 'auto') {
  if (Array.isArray(url_or_data)) return url_or_data;
  if (typeof url_or_data === 'string' && (url_or_data.includes('\n') || url_or_data.includes('\t'))) {
    return parse_alignments(url_or_data, format);
  }
  const response = await fetch(url_or_data);
  if (!response.ok) {
    throw new Error(`Failed to load alignments (${response.status}): ${url_or_data}`);
  }
  const text = await response.text();
  let detected_fmt = format;
  if (detected_fmt === 'auto' && typeof url_or_data === 'string') {
    const lower = url_or_data.toLowerCase();
    if (lower.endsWith('.paf')) detected_fmt = 'paf';
    else if (lower.endsWith('.sam')) detected_fmt = 'sam';
    else if (lower.endsWith('.m8') || lower.endsWith('.blast') || lower.endsWith('.outfmt6')) detected_fmt = 'blast6';
  }
  return parse_alignments(text, detected_fmt);
}

/**
 * Filter normalized alignments by score/MAPQ, minimum length, minimum identity, or secondary/supplementary flags.
 */
function filter_alignments(alignments, min_mapq_or_opts = 0, min_seq_length = 0, include_supplementary = true) {
  let opts;
  if (typeof min_mapq_or_opts === 'object' && min_mapq_or_opts !== null) {
    opts = min_mapq_or_opts;
  } else {
    opts = {
      min_mapq: min_mapq_or_opts,
      min_seq_length: min_seq_length,
      include_supplementary: include_supplementary
    };
  }
  const minScore = opts.min_score ?? opts.min_mapq ?? 0;
  const minLen = opts.min_length ?? opts.min_seq_length ?? 0;
  const minIdentity = opts.min_identity ?? 0;
  const allowSupp = opts.include_supplementary ?? true;

  return (alignments || []).filter(a => {
    if (a.flag && (a.flag & 0x4)) return false;
    if (!allowSupp && (a.is_secondary || a.is_supplementary)) return false;
    const score = a.score ?? a.mapq ?? 0;
    if (minScore > 0 && score < minScore) return false;
    const len = a.query_len ?? a.seq_length ?? ((a.end ?? 0) - (a.start ?? a.pos ?? 0));
    if (minLen > 0 && len < minLen) return false;
    if (minIdentity > 0 && a.identity !== null && a.identity !== undefined && a.identity < minIdentity) return false;
    return true;
  });
}

/**
 * Pack alignments into non-overlapping subtrack rows per contig using greedy interval scheduling.
 * Automatically places non-overlapping split/supplementary segments or paired-end mates sharing `group_id`
 * onto the same subtrack row whenever that row is free.
 */
function assign_subtracks(alignments, min_distance = 15) {
  if (!Array.isArray(alignments)) return [];

  for (const a of alignments) {
    if (a.contig === undefined && a.rname !== undefined) a.contig = a.rname;
    if (a.rname === undefined && a.contig !== undefined) a.rname = a.contig;
    if (a.start === undefined && a.pos !== undefined) a.start = a.pos;
    if (a.pos === undefined && a.start !== undefined) a.pos = a.start;
    if (a.id === undefined && a.qname !== undefined) a.id = a.qname;
    if (a.qname === undefined && a.id !== undefined) a.qname = a.id;
  }

  const sorted = [...alignments].sort((a, b) => {
    const ca = String(a.contig || '');
    const cb = String(b.contig || '');
    if (ca !== cb) return ca.localeCompare(cb);
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });

  const contig_row_ends = {};
  const group_last_row = {};

  for (const alignment of sorted) {
    const contig = String(alignment.contig || '');
    if (!contig_row_ends[contig]) {
      contig_row_ends[contig] = [];
    }
    const row_ends = contig_row_ends[contig];
    const group_key = alignment.group_id ? `${contig}::${alignment.group_id}` : null;
    let assigned_row = -1;

    // 1. Prefer the same subtrack row as an earlier segment of the same read/mate group if free
    if (group_key && group_last_row[group_key] !== undefined) {
      const pref_row = group_last_row[group_key];
      if (alignment.start >= row_ends[pref_row] + min_distance) {
        assigned_row = pref_row;
        row_ends[pref_row] = Math.max(row_ends[pref_row], alignment.end);
      }
    }

    // 2. Otherwise pick the first available non-overlapping row
    if (assigned_row === -1) {
      for (let i = 0; i < row_ends.length; i++) {
        if (alignment.start >= row_ends[i] + min_distance) {
          assigned_row = i;
          row_ends[i] = Math.max(row_ends[i], alignment.end);
          break;
        }
      }
    }

    // 3. Or open a new subtrack row
    if (assigned_row === -1) {
      assigned_row = row_ends.length;
      row_ends.push(alignment.end);
    }

    alignment.subtrack = assigned_row;
    if (group_key) {
      group_last_row[group_key] = assigned_row;
    }
  }

  return alignments;
}

export {
  fetch_server_data,
  parse_fasta,
  load_fasta,
  parse_genbank_flatfile,
  parse_genbank,
  load_genbank,
  parse_gff,
  load_gff,
  load_gene_table,
  calculate_cigar_stats,
  parse_sam,
  parse_paf,
  parse_blast6,
  parse_alignments,
  load_alignments,
  filter_alignments,
  assign_subtracks,
  fit_text,
  measure_text,
  reverse_complement,
  copy_sequence
};