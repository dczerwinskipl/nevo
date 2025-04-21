using LanguageExt;
using NEvo.Ddd.EventSourcing.Evolving;

namespace NEvo.Ddd.EventSourcing.Tests.Evolving;

public class AggregateEvolverTests
{
    [Fact]
    public void Evolve_WhenCalledWithNoAggregateAndCreatedEvent_ShouldReturnNewState()
    {
        // arrange
        var id = Guid.NewGuid();
        var aggregate = Option<Document>.None;
        var evolver = new AggregateEvolver([typeof(Document)]);
        var data = "Data";

        // act
        var result = evolver.Evolve(
            aggregate,
            new DocumentCreated(id, data)
        );

        // assert
        result.Should().BeRight().Which
            .Should().BeOfType<EditableDocument>().Which
            .Data.Should().Be(data);
    }

    [Fact]
    public void Evolve_WhenCalledWithNoAggregateAndNonCreatedEvent_ShouldReturnError()
    {
        // arrange
        var id = Guid.NewGuid();
        var aggregate = Option<Document>.None;
        var evolver = new AggregateEvolver([typeof(Document)]);
        var data = "Data";

        // act
        var result = evolver.Evolve(
            aggregate,
            new DocumentChanged(id, data)
        );

        // assert
        result.Should().BeLeft().Which
            .Should().BeOfType<Exception>().Which
            .Message.Should().Contain("No evolver found for event DocumentChanged on aggregate Document");
    }
}
