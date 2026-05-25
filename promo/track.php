<?php
// Simple download counter - stores in counts.json
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');

$countsFile = __DIR__ . '/counts.json';

// Get current counts
function getCounts() {
    global $countsFile;
    if (!file_exists($countsFile)) {
        return ['macos' => 0, 'windows' => 0];
    }
    $data = file_get_contents($countsFile);
    return json_decode($data, true) ?: ['macos' => 0, 'windows' => 0];
}

// Save counts
function saveCounts($counts) {
    global $countsFile;
    file_put_contents($countsFile, json_encode($counts));
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    // Track a download
    $input = json_decode(file_get_contents('php://input'), true);
    $platform = $input['platform'] ?? '';
    
    $counts = getCounts();
    if ($platform === 'macos') {
        $counts['macos']++;
    } elseif ($platform === 'windows') {
        $counts['windows']++;
    }
    saveCounts($counts);
    
    echo json_encode(['success' => true, 'counts' => $counts]);
} else {
    // Get current counts
    echo json_encode(getCounts());
}
