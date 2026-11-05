// 기존 글 양식에 사진 갤러리가 새로 추가된 경우에만 로드되는 라이트박스 (post-minami.html 과 동일 동작)
(function () {
  var imgs = Array.from(document.querySelectorAll('.gallery-grid img'));
  if (!imgs.length) return;
  var lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.id = 'lightbox';
    lb.innerHTML = '<span class="lightbox-close" id="lbClose">&times;</span>' +
      '<span class="lightbox-prev" id="lbPrev">&#8249;</span>' +
      '<img id="lbImg" src="" alt="">' +
      '<span class="lightbox-next" id="lbNext">&#8250;</span>';
    document.body.appendChild(lb);
  }
  var lbImg = document.getElementById('lbImg');
  var current = 0;

  function show(i) {
    current = (i + imgs.length) % imgs.length;
    lbImg.src = imgs[current].src;
    lb.classList.add('open');
  }

  imgs.forEach(function (img, i) {
    img.addEventListener('click', function () { show(i); });
  });

  document.getElementById('lbClose').addEventListener('click', function () { lb.classList.remove('open'); });
  document.getElementById('lbPrev').addEventListener('click', function () { show(current - 1); });
  document.getElementById('lbNext').addEventListener('click', function () { show(current + 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) lb.classList.remove('open'); });
  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'ArrowLeft') show(current - 1);
    if (e.key === 'ArrowRight') show(current + 1);
    if (e.key === 'Escape') lb.classList.remove('open');
  });
})();
