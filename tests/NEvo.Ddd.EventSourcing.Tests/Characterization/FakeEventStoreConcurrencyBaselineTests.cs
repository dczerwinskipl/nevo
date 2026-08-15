using LanguageExt;
using Microsoft.Extensions.DependencyInjection;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Characterizes FakeEventStore's version-mismatch return shape: a concurrency conflict
// flows through Either's Left, never a thrown CLR exception. The exception *type*
// returned is the dedicated AggregateConcurrencyException (not a plain Exception), and
// the expected-version parameter is ExpectedStreamState (not a bare int) — but the
// return-vs-throw shape itself has never changed.
public class FakeEventStoreConcurrencyBaselineTests
{
    [Fact]
    public async Task AppendEventsAsync_VersionMismatch_ReturnsAggregateConcurrencyExceptionInsteadOfThrowing()
    {
        var store = new FakeEventStore();
        var id = Guid.NewGuid();
        await store.AppendEventsAsync<Document, Guid>(id, [new DocumentCreated(id, "Data")], ExpectedStreamState.Exact(0), CancellationToken.None);

        Func<Task> act = async () => await store.AppendEventsAsync<Document, Guid>(id, [new DocumentCreated(id, "Data2")], ExpectedStreamState.Exact(0), CancellationToken.None);

        await act.Should().NotThrowAsync();
        var result = await store.AppendEventsAsync<Document, Guid>(id, [new DocumentCreated(id, "Data2")], ExpectedStreamState.Exact(0), CancellationToken.None);
        result.Should().BeLeft().Which.Should().BeOfType<AggregateConcurrencyException>();
    }
}
