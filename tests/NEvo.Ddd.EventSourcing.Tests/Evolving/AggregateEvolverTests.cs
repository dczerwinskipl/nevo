using NEvo.Ddd.EventSourcing.Evolving;

namespace NEvo.Ddd.EventSourcing.Tests.Evolving;

public class AggregateEvolverTests
{
    [Fact]
    public void Evolve_WhenCalledWithEventAvailableForAggregateState_ShouldReturnNewState()
    {
        // arrange
        var aggregate = DocumentAggregateBase.CreateEmpty(Guid.NewGuid());
        var evolver = new AggregateEvolver([typeof(DocumentAggregateBase)]);
        var data = "Data";

        // act
        var result = evolver.Evolve(
            aggregate,
            new DocumentCreated(aggregate.Id, data)
        );

        // assert
        result.Should().BeRight().Which
            .Should().BeOfType<EditableDocument>().Which
            .Data.Should().Be(data);
    }

    [Fact]
    public void Evolve_WhenCalledWithEventNotAvailableForAggregateState_ShouldReturnError()
    {
        // arrange
        var aggregate = DocumentAggregateBase.CreateEmpty(Guid.NewGuid());
        var evolver = new AggregateEvolver([typeof(DocumentAggregateBase)]);
        var data = "Data";

        // act
        var result = evolver.Evolve(
            aggregate,
            new DocumentChanged(aggregate.Id, data)
        );

        // assert
        result.Should().BeLeft().Which
            .Should().BeOfType<Exception>().Which
            .Message.Should().Contain("No evolver found for event DocumentChanged on aggregate EmptyDocument");
    }
}
