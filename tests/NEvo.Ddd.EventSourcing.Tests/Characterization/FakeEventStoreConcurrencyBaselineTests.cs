using LanguageExt;
using Microsoft.Extensions.DependencyInjection;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Originally characterized FakeEventStore's version-mismatch return shape (task 01,
// AC6): a concurrency conflict flows through Either's Left, never a thrown CLR
// exception. Task 02 (D13/D29) changes the exception *type* returned from a plain
// Exception to the dedicated AggregateConcurrencyException, and the expected-version
// parameter from a bare int to ExpectedStreamState — this test's call sites and type
// assertion are updated accordingly; the return-vs-throw shape itself is unchanged.
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
