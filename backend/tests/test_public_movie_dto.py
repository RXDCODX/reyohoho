"""Exercise the real DTO function without requiring a running Sanic/database stack."""
import ast
import asyncio
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest


class Expression:
    def __eq__(self, other):
        return self

    def in_(self, other):
        return self

    def is_(self, other):
        return self


class Query:
    def __init__(self, target):
        self.target = target

    def where(self, *args):
        return self


class Movie:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class UserList:
    list_type = Expression()
    user_id = Expression()
    content_id = Expression()


class TimingSubmission:
    kp_id = Expression()
    status = Expression()
    is_deleted = Expression()


class Session:
    def __init__(self):
        self.movie = None
        self.types = []

    async def get(self, model, key):
        return self.movie

    def add(self, model):
        if isinstance(model, Movie):
            self.movie = model

    async def scalars(self, query):
        return SimpleNamespace(all=lambda: self.types if query.target is UserList.list_type else [])

    async def commit(self):
        pass


async def timing_payloads(session, timings, user_id):
    return [{'viewer': user_id}]


class PublicMovieDtoTest(unittest.TestCase):
    def test_accounts_and_guest_do_not_mutate_provider_or_persist_personal_state(self):
        source = Path(__file__).resolve().parents[1] / 'routes_external.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'enrich_movie')
        module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), function], type_ignores=[])
        env = dict(deepcopy=deepcopy, Movie=Movie, UserList=UserList,
                   TimingSubmission=TimingSubmission, ViewEvent=lambda **kwargs: object(),
                   select=Query, timing_payloads=timing_payloads)
        exec(compile(ast.fix_missing_locations(module), str(source), 'exec'), env)

        async def scenario():
            session = Session()
            provider = {'title': 'Matrix', 'nested': {'cast': ['Neo']},
                        'lists': {'isFavorite': True}, 'nudity_timings': [{'viewer': 'stale'}]}
            original = deepcopy(provider)
            outputs = []
            for user_id, types in [(1, ['favorite']), (2, ['later']), (None, [])]:
                session.types = types
                request = SimpleNamespace(ctx=SimpleNamespace(db=session, user=SimpleNamespace(id=user_id) if user_id else None))
                result = await env['enrich_movie'](request, provider, '301')
                self.assertEqual(provider, original)
                self.assertFalse(any(session.movie.metadata_json['lists'].values()))
                self.assertNotIn('nudity_timings', session.movie.metadata_json)
                result['nested']['cast'].append('viewer mutation')
                self.assertEqual(session.movie.metadata_json['nested']['cast'], ['Neo'])
                self.assertEqual(result['nudity_timings'], [{'viewer': user_id}])
                outputs.append(result['lists'])
            self.assertTrue(outputs[0]['isFavorite'])
            self.assertFalse(outputs[1]['isFavorite'])
            self.assertTrue(outputs[1]['isLater'])
            self.assertFalse(any(outputs[2].values()))

        asyncio.run(scenario())


if __name__ == '__main__':
    unittest.main()
