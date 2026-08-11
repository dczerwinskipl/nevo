using LanguageExt;
using Microsoft.Extensions.DependencyInjection;

namespace NEvo.Ddd.EventSourcing.Tests;

// Task 02 (harden-event-store-and-repository-contracts): proves IEventStreamStore's
// NoStream/Exact(version) append semantics and the explicit-missing-stream read
// contract (D29), against FakeEventStore, the one shipped implementation.
public class FakeEventStoreExpectedStreamStateTests
{
    [Fact]
    public async Task LoadEventsStreamAsync_StreamNeverAppendedTo_ReturnsNone()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();

        var result = await store.LoadEventsStreamAsync<Document, Guid>(id, CancellationToken.None);

        result.Should().BeRight().Which.Should().BeNone();
    }

    [Fact]
    public async Task LoadEventsStreamAsync_ReadingMissingStreamTwice_DoesNotCreateItAsASideEffect()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();

        await store.LoadEventsStreamAsync<Document, Guid>(id, CancellationToken.None);
        await store.LoadEventsStreamAsync<Document, Guid>(id, CancellationToken.None);

        // If reading had side-effected an empty stream into existence, this NoStream
        // append would instead fail with AggregateConcurrencyException.
        var appendResult = await store.AppendEventsAsync<Document, Guid>(
            id, [new DocumentCreated(id, "Data")], ExpectedStreamState.NoStream, CancellationToken.None
        );

        appendResult.Should().BeRight();
    }

    [Fact]
    public async Task AppendEventsAsync_NoStream_WhenStreamDoesNotExist_Succeeds()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();

        var result = await store.AppendEventsAsync<Document, Guid>(
            id, [new DocumentCreated(id, "Data")], ExpectedStreamState.NoStream, CancellationToken.None
        );

        result.Should().BeRight();
        var loaded = await store.LoadEventsStreamAsync<Document, Guid>(id, CancellationToken.None);
        loaded.Should().BeRight().Which.Should().BeSome().Which.Version.Should().Be(1);
    }

    [Fact]
    public async Task AppendEventsAsync_NoStream_WhenStreamAlreadyExists_ReturnsAggregateConcurrencyException()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();
        await store.AppendEventsAsync<Document, Guid>(id, [new DocumentCreated(id, "Data")], ExpectedStreamState.NoStream, CancellationToken.None);

        var result = await store.AppendEventsAsync<Document, Guid>(
            id, [new DocumentCreated(id, "Data2")], ExpectedStreamState.NoStream, CancellationToken.None
        );

        result.Should().BeLeft().Which.Should().BeOfType<AggregateConcurrencyException>();
    }

    [Fact]
    public async Task AppendEventsAsync_Exact_AtObservedVersion_Succeeds()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();
        await store.AppendEventsAsync<Document, Guid>(id, [new DocumentCreated(id, "Data")], ExpectedStreamState.NoStream, CancellationToken.None);

        var result = await store.AppendEventsAsync<Document, Guid>(
            id, [new DocumentChanged(id, "Updated")], ExpectedStreamState.Exact(1), CancellationToken.None
        );

        result.Should().BeRight();
        var loaded = await store.LoadEventsStreamAsync<Document, Guid>(id, CancellationToken.None);
        loaded.Should().BeRight().Which.Should().BeSome().Which.Version.Should().Be(2);
    }

    [Fact]
    public async Task AppendEventsAsync_Exact_AfterAnotherWriterAdvancedTheStream_ReturnsAggregateConcurrencyException()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();
        await store.AppendEventsAsync<Document, Guid>(id, [new DocumentCreated(id, "Data")], ExpectedStreamState.NoStream, CancellationToken.None);
        await store.AppendEventsAsync<Document, Guid>(id, [new DocumentChanged(id, "FirstWriter")], ExpectedStreamState.Exact(1), CancellationToken.None);

        // A second writer still expects version 1 (stale read) — the stream is now at 2.
        var result = await store.AppendEventsAsync<Document, Guid>(
            id, [new DocumentChanged(id, "SecondWriter")], ExpectedStreamState.Exact(1), CancellationToken.None
        );

        result.Should().BeLeft().Which.Should().BeOfType<AggregateConcurrencyException>();
    }

    // Owner code review (2026-08-11): the version check (TryGetValue -> compare) and the
    // mutation (AddRange) were not one atomic unit — two genuinely concurrent Exact(1)
    // appends could both observe version 1 and both pass. A Barrier forces both threads
    // into the critical section as close to simultaneously as possible so this test
    // actually exercises the race, not just a sequential re-enactment of it.
    [Fact]
    public async Task AppendEventsAsync_TwoConcurrentAppendsAtTheSameExpectedVersion_ExactlyOneSucceeds()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();
        await store.AppendEventsAsync<Document, Guid>(id, [new DocumentCreated(id, "Data")], ExpectedStreamState.NoStream, CancellationToken.None);
        using var barrier = new Barrier(2);

        async Task<Either<Exception, Unit>> AppendAsync(string data)
        {
            barrier.SignalAndWait();
            return await store.AppendEventsAsync<Document, Guid>(id, [new DocumentChanged(id, data)], ExpectedStreamState.Exact(1), CancellationToken.None);
        }

        var results = await Task.WhenAll(Task.Run(() => AppendAsync("A")), Task.Run(() => AppendAsync("B")));

        results.Count(r => r.IsRight).Should().Be(1);
        results.Where(r => r.IsLeft).Should().ContainSingle().Which.Should().BeLeft().Which.Should().BeOfType<AggregateConcurrencyException>();
        var loaded = await store.LoadEventsStreamAsync<Document, Guid>(id, CancellationToken.None);
        loaded.Should().BeRight().Which.Should().BeSome().Which.Version.Should().Be(2);
    }

    // Owner code review (2026-08-11): the store was keyed by streamId alone, so two
    // different aggregate types sharing the same id value (e.g. Document(Guid X) and
    // OtherAggregate(Guid X)) collided into a single stream — silently mixing
    // incompatible event types (and eventually a bad cast on load).
    [Fact]
    public async Task AppendEventsAsync_SameStreamIdValue_DifferentAggregateTypes_DoNotCollide()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();

        var documentResult = await store.AppendEventsAsync<Document, Guid>(id, [new DocumentCreated(id, "Data")], ExpectedStreamState.NoStream, CancellationToken.None);
        var otherResult = await store.AppendEventsAsync<OtherAggregate, Guid>(id, [new OtherAggregateCreated(id)], ExpectedStreamState.NoStream, CancellationToken.None);

        // Both succeed as NoStream creates — if the streams collided, the second append
        // would instead fail with AggregateConcurrencyException (stream already exists).
        documentResult.Should().BeRight();
        otherResult.Should().BeRight();

        var documentStream = await store.LoadEventsStreamAsync<Document, Guid>(id, CancellationToken.None);
        var (documentEvents, documentVersion) = documentStream.Should().BeRight().Which.Should().BeSome().Which;
        documentVersion.Should().Be(1);
        documentEvents.Should().ContainSingle().Which.Should().BeOfType<DocumentCreated>();

        var otherStream = await store.LoadEventsStreamAsync<OtherAggregate, Guid>(id, CancellationToken.None);
        var (otherEvents, otherVersion) = otherStream.Should().BeRight().Which.Should().BeSome().Which;
        otherVersion.Should().Be(1);
        otherEvents.Should().ContainSingle().Which.Should().BeOfType<OtherAggregateCreated>();
    }
}
