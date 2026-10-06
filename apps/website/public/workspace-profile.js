export const photoSubjects = [
  {id:'landscape',label:'风景'},
  {id:'portrait',label:'人物'},
  {id:'street',label:'街头'},
  {id:'architecture',label:'建筑'},
  {id:'night',label:'夜景'},
  {id:'other',label:'其他'},
  {id:'unclassified',label:'待分类'}
];

export const subjectLabel = id => photoSubjects.find(item => item.id === id)?.label || '待分类';
export const validSubject = id => photoSubjects.some(item => item.id === id) ? id : 'unclassified';

export function aspectKind(width,height) {
  if (!(width > 0 && height > 0)) return 'unknown';
  const ratio = width / height;
  if (ratio > 1.08) return 'landscape';
  if (ratio < 1 / 1.08) return 'portrait';
  return 'square';
}

export function summarizeWorkspace(photos) {
  const subjects = Object.fromEntries(photoSubjects.map(item => [item.id,0]));
  const aspects = {landscape:0,portrait:0,square:0,unknown:0};
  for (const photo of photos) {
    subjects[validSubject(photo.subject)]++;
    const image = photo.image || photo;
    aspects[aspectKind(image.naturalWidth ?? image.width,image.naturalHeight ?? image.height)]++;
  }
  return {total:photos.length,subjects,aspects};
}
