<?php
// config.php - Helper untuk database JSON
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE');

$dataDir = __DIR__ . '/data';
$uploadDir = __DIR__ . '/uploads';

if (!file_exists($dataDir)) mkdir($dataDir, 0777, true);
if (!file_exists($uploadDir)) mkdir($uploadDir, 0777, true);

$booksFile = $dataDir . '/books.json';

function getBooks() {
    global $booksFile;
    if (!file_exists($booksFile)) return [];
    $content = file_get_contents($booksFile);
    return json_decode($content, true) ?: [];
}

function saveBooks($books) {
    global $booksFile;
    file_put_contents($booksFile, json_encode($books, JSON_PRETTY_PRINT));
}
?>
