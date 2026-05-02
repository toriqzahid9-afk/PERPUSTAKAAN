<?php
require_once 'config.php';

// DELETE atau GET dengan action=delete
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
?>
