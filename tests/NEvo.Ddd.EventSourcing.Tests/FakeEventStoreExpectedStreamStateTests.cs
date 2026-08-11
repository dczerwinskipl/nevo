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
}
