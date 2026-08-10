using LanguageExt;
using NEvo.Ddd.EventSourcing;
using System.Collections.Concurrent;

namespace NEvo.Ddd.EventSourcing.Tests.Mocks;

// WORKAROUND, not a pattern to copy: this conflates event persistence with read-model
// projection (AppendEventsAsync hand-builds a DocumentDto directly instead of just
// storing raw events, and LoadAggregateAsync still returns None like FakeEventStore).
// It exists only because FakeEventStore (the framework default) never persists
// anything, and there is no real generic event-replay/repository mechanism in
// NEvo.Ddd.EventSourcing yet for GetDocumentQuery to demonstrate a genuine
// create-then-query round trip against. PR #10 ("Feature/event sourcing",
// feature/event-sourcing) reworks the store into a proper aggregate repository with
// versioning and real replay — once that lands, delete this class and have
// GetDocumentQueryHandler read through the real repository/projection mechanism
// instead.
public class InMemoryDocumentEventStore : IEventStore
{
    private readonly ConcurrentDictionary<object, List<dynamic>> _store = new();
    private readonly ConcurrentDictionary<Guid, DocumentDto> _documents = new();

    public EitherAsync<Exception, Unit> AppendEventsAsync<TAggregate, TId>(TId streamId, IEnumerable<IAggregateEvent<TAggregate, TId>> events, int expectedVersion, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var pendingEvents = events.ToList();
        var stream = _store.GetOrAdd(streamId, _ => []);
        if (expectedVersion != stream.Count)
        {
            return new Exception($"Expected version {expectedVersion} but found {stream.Count}");
        }
        stream.AddRange(pendingEvents);

        foreach (var @event in pendingEvents)
        {
            switch (@event)
            {
                case DocumentCreated created:
                    _documents[created.DocumentId] = new DocumentDto(created.DocumentId, created.Data, Approved: false);
                    break;
                case DocumentChanged changed when _documents.TryGetValue(changed.DocumentId, out var existing):
                    _documents[changed.DocumentId] = existing with { Data = changed.Data };
                    break;
                case DocumentApproved approved when _documents.TryGetValue(approved.DocumentId, out var existing):
                    _documents[approved.DocumentId] = existing with { Approved = true };
                    break;
            }
        }

        return Unit.Default;
    }

    public EitherAsync<Exception, (IEnumerable<IAggregateEvent<TAggregate, TId>> Events, int Version)> LoadEventsStreamAsync<TAggregate, TId>(TId streamId, CancellationToken cancellationToken)
        where TAggregate : IAggregateRoot<TId>
        where TId : notnull
    {
        var stream = _store.GetOrAdd(streamId, _ => []);
        return (stream.Cast<IAggregateEvent<TAggregate, TId>>(), stream.Count);
    }

    public OptionAsync<TProjection> LoadProjectionAsync<TProjection, TId>(TId projectionId)
        where TProjection : IProjectable<TId>
        where TId : notnull
    {
        if (projectionId is Guid documentId && _documents.TryGetValue(documentId, out var dto) && dto is TProjection projection)
        {
            return OptionAsync<TProjection>.Some(projection);
        }

        return OptionAsync<TProjection>.None;
    }
}
