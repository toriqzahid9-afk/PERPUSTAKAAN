<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Mengizinkan akses dari port lain (seperti live server)
header('Access-Control-Allow-Methods: GET, POST, DELETE');

$method = $_SERVER['REQUEST_METHOD'];
$dataDir = __DIR__ . '/data';
$uploadDir = __DIR__ . '/uploads';

// Buat folder jika belum ada
if (!file_exists($dataDir)) mkdir($dataDir, 0777, true);
if (!file_exists($uploadDir)) mkdir($uploadDir, 0777, true);

$booksFile = $dataDir . '/books.json';

// Fungsi baca buku
function getBooks() {
    global $booksFile;
    if (!file_exists($booksFile)) return [];
    $content = file_get_contents($booksFile);
    return json_decode($content, true) ?: [];
}

// Fungsi simpan buku
function saveBooks($books) {
    global $booksFile;
    file_put_contents($booksFile, json_encode($books, JSON_PRETTY_PRINT));
}

// 1. GET: Ambil daftar buku
if ($method === 'GET') {
    echo json_encode(getBooks());
    exit;
}

// 2. POST: Tambah buku baru
if ($method === 'POST') {
    $title = $_POST['title'] ?? '';
    $author = $_POST['author'] ?? '';
    
    if (!$title || !isset($_FILES['pdf'])) {
        echo json_encode(['success' => false, 'message' => 'Data tidak lengkap']);
        exit;
    }
    
    $pdfUrl = null;
    $coverUrl = null;
    
    // Handle PDF upload
    if (isset($_FILES['pdf']) && $_FILES['pdf']['error'] === UPLOAD_ERR_OK) {
        $pdfName = time() . '-' . rand(1000, 9999) . '-' . preg_replace('/[^a-zA-Z0-9.\-_]/', '', basename($_FILES['pdf']['name']));
        if (move_uploaded_file($_FILES['pdf']['tmp_name'], $uploadDir . '/' . $pdfName)) {
            $pdfUrl = 'uploads/' . $pdfName; // Path relatif untuk dipanggil di HTML
        }
    }
    
    // Handle Cover upload
    if (isset($_FILES['cover']) && $_FILES['cover']['error'] === UPLOAD_ERR_OK) {
        $coverName = time() . '-' . rand(1000, 9999) . '-' . preg_replace('/[^a-zA-Z0-9.\-_]/', '', basename($_FILES['cover']['name']));
        if (move_uploaded_file($_FILES['cover']['tmp_name'], $uploadDir . '/' . $coverName)) {
            $coverUrl = 'uploads/' . $coverName;
        }
    }
    
    $books = getBooks();
    $newBook = [
        'id' => (string)time(),
        'title' => $title,
        'author' => $author,
        'pdfUrl' => $pdfUrl,
        'coverUrl' => $coverUrl,
        'createdAt' => date('c')
    ];
    
    array_unshift($books, $newBook); // Tambah di posisi awal
    saveBooks($books);
    
    echo json_encode(['success' => true, 'book' => $newBook]);
    exit;
}

// 3. DELETE: Hapus buku
if ($method === 'DELETE' || (isset($_GET['action']) && $_GET['action'] === 'delete')) {
    $id = $_GET['id'] ?? '';
    if (!$id) {
        echo json_encode(['success' => false, 'message' => 'ID tidak ditemukan']);
        exit;
    }
    
    $books = getBooks();
    $newBooks = [];
    $deleted = false;
    
    foreach ($books as $book) {
        if ($book['id'] === $id) {
            // Hapus file fisik
            if (!empty($book['pdfUrl']) && file_exists(__DIR__ . '/' . $book['pdfUrl'])) {
                unlink(__DIR__ . '/' . $book['pdfUrl']);
            }
            if (!empty($book['coverUrl']) && file_exists(__DIR__ . '/' . $book['coverUrl'])) {
                unlink(__DIR__ . '/' . $book['coverUrl']);
            }
            $deleted = true;
        } else {
            $newBooks[] = $book;
        }
    }
    
    if ($deleted) {
        saveBooks($newBooks);
    }
    
    echo json_encode(['success' => $deleted]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Method not allowed']);
?>
