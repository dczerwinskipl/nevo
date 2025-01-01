using FluentAssertions.Execution;
using FluentAssertions.Primitives;
using LanguageExt;

namespace NEvo.Gdpr.Consents.Tests;

public static class EitherAssertionsExtensions
{
    public static EitherAssertions<L, R> Should<L, R>(this Either<L, R> either)
    {
        return new EitherAssertions<L, R>(either);
    }
}

public class EitherAssertions<L, R>(Either<L, R> either) : ReferenceTypeAssertions<Either<L, R>, EitherAssertions<L, R>>(either)
{
    protected override string Identifier => "either";

    public AndWhichConstraint<EitherAssertions<L, R>, R> BeRight(string because = "", params object[] becauseArgs)
    {
        return new AndWhichConstraint<EitherAssertions<L, R>, R>(this, 
            Subject.IfLeft(l => throw new AssertionFailedException("Expected {context:either} to be Right but it was Left."))
        );
    }

    public AndWhichConstraint<EitherAssertions<L, R>, L> BeLeft(string because = "", params object[] becauseArgs)
    {
        return new AndWhichConstraint<EitherAssertions<L, R>, L>(this, 
            Subject.IfRight(r => throw new AssertionFailedException("Expected {context:either} to be Left but it was Right."))
        );
    }
}