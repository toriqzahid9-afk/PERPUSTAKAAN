// =============================================
//   DELPIK DIGITAL - JavaScript
// =============================================

// Konfigurasi PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// --- STATE GLOBAL ---
let books = [];
let isAdmin = false;
let tempFiles = { pdf: null, cover: null };
let db;

// =============================================
//   DATABASE (IndexedDB)
// =============================================

async function initDB() {
    return new Promise((resolve) => {
        const request = indexedDB.open('DelpikFlipbookDB', 1);

        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore('books', { keyPath: 'id' });
        };

        request.onsuccess = (e) => {
            db = e.target.result;
            loadBooksFromDB().then(resolve);
        };
    });
}

async function loadBooksFromDB() {
    return new Promise((resolve) => {
        const store = db.transaction(['books'], 'readonly').objectStore('books');
        const request = store.getAll();
        request.onsuccess = () => {
            books = request.result || [];
            render();
            resolve();
        };
    });
}

// =============================================
//   FLIPBOOK / READER LOGIC
// =============================================

async function openBook(id) {
    const book = books.find(b => b.id === id);
    if (!book) return;

    const overlay  = document.getElementById('reader-overlay');
    const flipbook = document.getElementById('flipbook');
    const spinner  = document.getElementById('loading-spinner');

    overlay.style.display = 'flex';
    spinner.style.display = 'flex';
    flipbook.innerHTML = ''; // Reset konten sebelumnya

    try {
        console.log('Mencoba memuat buku:', book.title);
        
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('Library PDF.js belum dimuat. Periksa koneksi internet Anda.');
        }

        // Cek data PDF
        if (!book.pdf) throw new Error('Data PDF tidak ditemukan pada objek buku.');
        
        // Ambil blob (bisa di book.pdf.blob atau langsung di book.pdf)
        const pdfBlob = book.pdf.blob || book.pdf;
        
        if (!(pdfBlob instanceof Blob)) {
            throw new Error('Data PDF bukan merupakan Blob/File yang valid.');
        }

        const pdfData = await pdfBlob.arrayBuffer();
        const pdf     = await pdfjsLib.getDocument({ data: pdfData }).promise;

        console.log('PDF berhasil dimuat. Jumlah halaman:', pdf.numPages);

        // Render setiap halaman PDF ke elemen <canvas>
        for (let i = 1; i <= pdf.numPages; i++) {
            const page     = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });

            const canvas  = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width  = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const pageDiv = document.createElement('div');
            pageDiv.className = 'flipbook-page';
            pageDiv.appendChild(canvas);
            flipbook.appendChild(pageDiv);
        }

        // Inisialisasi Turn.js (Flipbook)
        const isMobile = window.innerWidth < 768;
        $(flipbook).turn({
            width: isMobile ? window.innerWidth * 0.95 : (window.innerWidth > 1000 ? 1000 : window.innerWidth * 0.9),
            height: isMobile ? window.innerHeight * 0.7 : window.innerHeight * 0.8,
            autoCenter: true,
            display: isMobile ? 'single' : 'double',
            acceleration: true,
            gradients: true,
            when: {
                turning: function(e, page) {
                    document.getElementById('page-number').innerText = `Hal. ${page}`;
                }
            }
        });

        spinner.style.display = 'none';

    } catch (err) {
        console.error('CRITICAL ERROR:', err);
        alert('Gagal memuat buku: ' + err.message);
        closeReader();
    }
}

function closeReader() {
    document.getElementById('reader-overlay').style.display = 'none';
    try {
        $('#flipbook').turn('destroy');
    } catch (e) { /* abaikan jika belum diinisialisasi */ }
}

// =============================================
//   ADMIN: UPLOAD & KELOLA BUKU
// =============================================

function handleFileChange(input, labelId) {
    if (input.files && input.files[0]) {
        const file = input.files[0];

        if (labelId === 'pdf-label') {
            tempFiles.pdf = { blob: file, name: file.name };
        } else {
            tempFiles.cover = file;
        }

        const label = document.getElementById(labelId);
        label.textContent = file.name;
        label.classList.add('text-cyan-400');
    }
}

document.getElementById('add-book-form').onsubmit = async (e) => {
    e.preventDefault();

    const newBook = {
        id: Date.now(),
        title:  document.getElementById('add-title').value,
        author: document.getElementById('add-author').value,
        pdf:    tempFiles.pdf,
        cover:  tempFiles.cover || null
    };

    const tx = db.transaction(['books'], 'readwrite');
    tx.objectStore('books').add(newBook);

    tx.oncomplete = () => {
        books.unshift(newBook);
        render();
        e.target.reset();

        // Reset label upload
        document.getElementById('pdf-label').textContent   = 'Unggah File PDF';
        document.getElementById('cover-label').textContent = 'Unggah Gambar Sampul';
        document.getElementById('pdf-label').classList.remove('text-cyan-400');
        document.getElementById('cover-label').classList.remove('text-cyan-400');
        tempFiles = { pdf: null, cover: null };

        alert('Buku Berhasil Ditambahkan!');
    };
};

function deleteBook(id) {
    if (!confirm('Hapus buku ini?')) return;
    const tx = db.transaction(['books'], 'readwrite');
    tx.objectStore('books').delete(id);
    tx.oncomplete = () => {
        books = books.filter(b => b.id !== id);
        render();
    };
}

// =============================================
//   RENDER UI
// =============================================

function render() {
    const grid = document.getElementById('book-grid');
    const list = document.getElementById('admin-book-list');

    // --- Render kartu buku di halaman utama ---
    grid.innerHTML = books.map(b => `
        <div class="book-card" onclick="openBook(${b.id})">
            <div class="book-cover-container">
                <img src="${b.cover
                    ? URL.createObjectURL(b.cover)
                    : 'https://via.placeholder.com/150x220/222/00f2ff?text=DELPIK'}"
                     alt="Sampul ${b.title}">
            </div>
            <div class="flex flex-col justify-between py-2">
                <div>
                    <h4 class="font-bold text-white text-xs uppercase">${b.title}</h4>
                    <p class="text-[10px] text-gray-500 mt-1">${b.author}</p>
                </div>
                <div class="text-[8px] text-cyan-500 font-bold tracking-widest mt-4">KLIK UNTUK MEMBACA</div>
            </div>
        </div>
    `).join('');

    // --- Render tabel di dashboard admin ---
    list.innerHTML = books.map(b => `
        <tr>
            <td class="text-xs font-bold uppercase">${b.title}</td>
            <td class="text-[10px] text-gray-500">${b.author}</td>
            <td class="text-right">
                <button onclick="deleteBook(${b.id})" class="text-red-500/50 hover:text-red-500">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// =============================================
//   SEARCH (PENCARIAN BUKU)
// =============================================

document.getElementById('search-input').addEventListener('input', function () {
    const query = this.value.toLowerCase().trim();
    const cards = document.querySelectorAll('#book-grid .book-card');

    cards.forEach(card => {
        const title  = card.querySelector('h4').textContent.toLowerCase();
        const author = card.querySelector('p').textContent.toLowerCase();
        card.style.display = (title.includes(query) || author.includes(query)) ? '' : 'none';
    });
});

// =============================================
//   NAVIGASI SPA (SINGLE PAGE APPLICATION)
// =============================================

function showPage(id) {
    document.querySelectorAll('.spa-content').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function handleLogoClick() {
    isAdmin ? showPage('admin-dashboard') : showPage('login');
}

document.getElementById('login-form').onsubmit = (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;

    if (email === 'admin@perpus.id' && pass === '654321') {
        isAdmin = true;
        
        // Update Desktop UI
        document.getElementById('admin-link').classList.remove('hidden');
        document.getElementById('logout-btn').classList.remove('hidden');
        
        // Update Mobile UI
        document.getElementById('admin-link-mobile')?.classList.remove('hidden');
        document.getElementById('logout-btn-mobile')?.classList.remove('hidden');
        
        showPage('admin-dashboard');
        render();
    } else {
        alert('Email atau Password salah!');
    }
};

function logout() {
    isAdmin = false;
    
    // Update Desktop UI
    document.getElementById('admin-link').classList.add('hidden');
    document.getElementById('logout-btn').classList.add('hidden');
    
    // Update Mobile UI
    document.getElementById('admin-link-mobile')?.classList.add('hidden');
    document.getElementById('logout-btn-mobile')?.classList.add('hidden');
    
    showPage('main-view');
}

// =============================================
//   MOBILE MENU LOGIC
// =============================================

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('active');
}

function closeAndShowPage(pageId) {
    toggleMobileMenu();
    showPage(pageId);
    
    // Jika katalog, scroll ke situ
    if (pageId === 'main-view' && window.location.hash === '#katalog-section') {
        setTimeout(() => {
            document.getElementById('katalog-section').scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
}

document.getElementById('mobile-menu-btn').addEventListener('click', toggleMobileMenu);
document.getElementById('close-mobile-menu').addEventListener('click', toggleMobileMenu);

// Tutup menu jika klik di area backdrop (luar drawer)
document.getElementById('mobile-menu').addEventListener('click', function(e) {
    if (e.target === this) {
        toggleMobileMenu();
    }
});

// =============================================
//   INISIALISASI
// =============================================
window.onload = () => {
    initDB();
    
    // Pastikan mobile menu tertutup saat resize ke desktop
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            document.getElementById('mobile-menu').classList.remove('active');
        }
    });
};
