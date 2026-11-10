(function () {
  var SIZE = 10;
  var gameId = null;

  var yourTable = document.getElementById('your-board');
  var enemyTable = document.getElementById('enemy-board');
  var message = document.getElementById('message');
  var placeButton = document.getElementById('place-random');

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) { throw new Error(data.error || 'Request failed'); }
        return data;
      });
    });
  }

  function key(r, c) { return r + ',' + c; }

  function draw(table, cellClass, onClick) {
    table.innerHTML = '';
    for (var r = 0; r < SIZE; r++) {
      var tr = document.createElement('tr');
      for (var c = 0; c < SIZE; c++) {
        var td = document.createElement('td');
        var info = cellClass(r, c);
        td.className = info.cls;
        td.textContent = info.text;
        if (onClick && info.cls.indexOf('open') >= 0) {
          td.addEventListener('click', onClick.bind(null, r, c));
        }
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
  }

  function render(game) {
    var ships = {};
    game.yourBoard.ships.forEach(function (s) {
      s.cells.forEach(function (cell) { ships[key(cell.row, cell.col)] = true; });
    });
    var shotsAtYou = {};
    game.yourBoard.shotsAgainstYou.forEach(function (s) { shotsAtYou[key(s.row, s.col)] = s.hit; });
    var myShots = {};
    game.enemyBoard.shotsByYou.forEach(function (s) { myShots[key(s.row, s.col)] = s.hit; });

    draw(yourTable, function (r, c) {
      var k = key(r, c);
      if (k in shotsAtYou) { return shotsAtYou[k] ? { cls: 'hit', text: 'X' } : { cls: 'miss', text: '•' }; }
      return { cls: ships[k] ? 'ship' : '', text: '' };
    });

    var canFire = game.status === 'IN_PROGRESS';
    draw(enemyTable, function (r, c) {
      var k = key(r, c);
      if (k in myShots) { return myShots[k] ? { cls: 'hit', text: 'X' } : { cls: 'miss', text: '•' }; }
      return { cls: canFire ? 'open' : '', text: '' };
    }, fire);

    placeButton.disabled = game.status !== 'SETUP';
    if (game.status === 'SETUP') {
      message.textContent = 'Place your fleet.';
    } else if (game.status === 'IN_PROGRESS') {
      message.textContent = 'Your move. Enemy ships left: ' + game.enemyBoard.shipsRemaining;
    } else {
      message.textContent = game.winner === 'PLAYER' ? 'You win!' : 'The computer wins.';
    }
  }

  function fire(row, col) {
    api('POST', '/api/games/' + gameId + '/shots', { row: row, col: col })
      .then(function (res) {
        render(res.game);
        var text = 'You: ' + res.playerShot.result + (res.playerShot.sunkShip ? ' (' + res.playerShot.sunkShip + ')' : '');
        if (res.computerShot) {
          text += '. Computer: ' + res.computerShot.result;
        }
        if (res.game.status === 'FINISHED') {
          text = message.textContent;
        }
        message.textContent = text;
      })
      .catch(function (e) { message.textContent = e.message; });
  }

  document.getElementById('new-game').addEventListener('click', function () {
    api('POST', '/api/games').then(function (game) {
      gameId = game.id;
      render(game);
    }).catch(function (e) { message.textContent = e.message; });
  });

  placeButton.addEventListener('click', function () {
    api('POST', '/api/games/' + gameId + '/ships/random').then(render)
      .catch(function (e) { message.textContent = e.message; });
  });
})();
