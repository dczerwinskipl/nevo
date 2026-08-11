using System.Collections;
using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using NEvo.Ddd.EventSourcing.Evolving;

namespace NEvo.Ddd.EventSourcing.Tests;

public class AggregateRepositoryApplyEventsTests
{
    private static AggregateRepository CreateRepository()
        => new(new FakeEventStore(), new Mock<IEvolverRegistry>().Object);

    // Enumerates lazily and counts how many elements were actually pulled, so a test can
    // prove ApplyEvents stops enumerating once it hits a failing event instead of
    // enumerating the whole sequence regardless.
    private class CountingEvents(params IAggregateEvent<Document, Guid>[] events) : IEnumerable<IAggregateEvent<Document, Guid>>
    {
        public int EnumeratedCount { get; private set; }

        public IEnumerator<IAggregateEvent<Document, Guid>> GetEnumerator()
        {
            foreach (var @event in events)
            {
                EnumeratedCount++;
                yield return @event;
            }
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    [Fact]
    public void ApplyEvents_EmptySequence_ReturnsRightNone()
    {
        var repository = CreateRepository();
        var evolverMock = new Mock<IEvolver>();

        var result = repository.ApplyEvents(new CountingEvents(), evolverMock.Object);

        result.Should().BeRight().Which.Should().BeNone();
    }

    [Fact]
    public void ApplyEvents_OneEvent_ReturnsSomeWithEvolvedState()
    {
        var repository = CreateRepository();
        var id = Guid.NewGuid();
        var created = new DocumentCreated(id, "Data");
        var evolverMock = new Mock<IEvolver>();
        evolverMock.Setup(e => e.Evolve<Document, Guid>(Option<Document>.None, created))
            .Returns(new EditableDocument(id, "Data"));

        var result = repository.ApplyEvents(new CountingEvents(created), evolverMock.Object);

        result.Should().BeRight().Which.Should().BeSome().Which.Should().BeOfType<EditableDocument>().Which.Data.Should().Be("Data");
    }

    [Fact]
    public void ApplyEvents_MultipleEvents_FoldsToTheFinalState()
    {
        var repository = CreateRepository();
        var id = Guid.NewGuid();
        var created = new DocumentCreated(id, "Data");
        var changed = new DocumentChanged(id, "Updated");
        var initial = new EditableDocument(id, "Data");
        var final = new EditableDocument(id, "Updated");
        var evolverMock = new Mock<IEvolver>();
        evolverMock.Setup(e => e.Evolve<Document, Guid>(Option<Document>.None, created)).Returns(initial);
        evolverMock.Setup(e => e.Evolve<Document, Guid>(Option<Document>.Some(initial), changed)).Returns(final);

        var result = repository.ApplyEvents(new CountingEvents(created, changed), evolverMock.Object);

        result.Should().BeRight().Which.Should().BeSome().Which.Should().Be(final);
    }

    [Fact]
    public void ApplyEvents_FailureOnASingleEvent_ShortCircuits_RemainingEventsAreNeverEnumerated()
    {
        var repository = CreateRepository();
        var id = Guid.NewGuid();
        var created = new DocumentCreated(id, "Data");
        var failing = new DocumentChanged(id, "Bad");
        var neverReached = new DocumentChanged(id, "Unreachable");
        var initial = new EditableDocument(id, "Data");
        var failure = new Exception("evolve failed");
        var evolverMock = new Mock<IEvolver>();
        evolverMock.Setup(e => e.Evolve<Document, Guid>(Option<Document>.None, created)).Returns(initial);
        evolverMock.Setup(e => e.Evolve<Document, Guid>(Option<Document>.Some(initial), failing)).Returns(failure);
        var events = new CountingEvents(created, failing, neverReached);

        var result = repository.ApplyEvents(events, evolverMock.Object);

        result.Should().BeLeft().Which.Should().BeSameAs(failure);
        events.EnumeratedCount.Should().Be(2);
    }
}
