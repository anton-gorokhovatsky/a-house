"""Hold the jury export lock through Supabase read, Google write and readback."""
import fcntl
import pathlib
import select
import sys

private = pathlib.Path(__file__).resolve().parents[3] / '.work/jury-final-hosted/google-sheets'
with (private / 'sync.lock').open('a') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('busy', flush=True)
        sys.exit(0)
    print('locked', flush=True)
    while select.select([sys.stdin], [], [], 300)[0]:
        if sys.stdin.readline().strip() != 'renew':
            break
        print('held', flush=True)
